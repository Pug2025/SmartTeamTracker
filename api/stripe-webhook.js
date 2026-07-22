// api/stripe-webhook.js
// POST only. Stripe authenticates via the Stripe-Signature header (no Firebase
// auth). This is the ONLY writer of the entitlements table.
//
// Flow: read the RAW body, verify the HMAC-SHA256 signature against
// STRIPE_WEBHOOK_SECRET (constant-time, reject if older than 5 min), then
// upsert the entitlements row keyed by the Firebase uid we stamped onto the
// checkout session / subscription metadata. Idempotent via last_event_at.

import { createHmac, timingSafeEqual } from 'node:crypto';

// Vercel would otherwise JSON-parse the body and we could not recompute the
// signature over the exact bytes Stripe signed.
export const config = { api: { bodyParser: false } };

const STRIPE_API = 'https://api.stripe.com/v1';
const MAX_SKEW_SEC = 5 * 60; // reject signatures older/newer than 5 minutes

function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.concat(chunks)));
  });
}

// Parse a Stripe-Signature header: "t=123,v1=abc,v1=def".
function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || '').split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') out.t = v;
    else if (k === 'v1') out.v1.push(v);
  }
  return out;
}

function verifySignature(rawBody, header, secret) {
  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !v1.length) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) return false;

  const expected = createHmac('sha256', secret)
    .update(t + '.', 'utf8')
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  // Constant-time compare against each provided v1 signature.
  for (const sig of v1) {
    let sigBuf;
    try { sigBuf = Buffer.from(sig, 'hex'); } catch (_) { continue; }
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

async function stripeGet(path, secretKey) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function isoFromUnix(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

// Period end lives at the subscription top level on older Stripe API versions
// and on the subscription item on newer ones. Read whichever is present.
function subPeriodEndIso(sub) {
  if (!sub) return null;
  const item = sub.items && sub.items.data && sub.items.data[0];
  return isoFromUnix(sub.current_period_end)
    || (item ? isoFromUnix(item.current_period_end) : null);
}

// Map a Stripe subscription status to our entitlement status vocabulary.
function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null; // unknown — don't overwrite blindly
  }
}

// Idempotent upsert keyed by uid. Skips stale events by comparing the event
// timestamp against the row's stored last_event_at.
async function upsertEntitlement({ supabaseUrl, supabaseKey, uid, patch, eventIso }) {
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // Stale-guard: if we already applied a newer/equal event, ignore this one.
  try {
    const cur = await fetch(
      `${supabaseUrl}/rest/v1/entitlements?uid=eq.${encodeURIComponent(uid)}&select=last_event_at&limit=1`,
      { headers }
    );
    if (cur.ok) {
      const rows = await cur.json();
      const last = Array.isArray(rows) && rows.length ? rows[0].last_event_at : null;
      if (last && eventIso && Date.parse(last) >= Date.parse(eventIso)) {
        return; // stale / duplicate — nothing to do
      }
    }
  } catch (_) { /* fall through and attempt the write */ }

  const body = {
    uid,
    ...patch,
    last_event_at: eventIso,
    updated_at: new Date().toISOString()
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`entitlements upsert failed: ${res.status} ${detail}`);
  }
}

// past_due path keyed on the Stripe customer id (invoice events do not carry
// our uid metadata reliably).
async function markPastDueByCustomer({ supabaseUrl, supabaseKey, customerId, eventIso }) {
  if (!customerId) return;
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };
  await fetch(
    `${supabaseUrl}/rest/v1/entitlements?stripe_customer_id=eq.${encodeURIComponent(customerId)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: 'past_due', last_event_at: eventIso, updated_at: new Date().toISOString() })
    }
  ).catch((e) => console.warn("past_due patch warning:", e));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // Read the raw bytes before anything else.
  const rawBody = await readRawBody(req);
  const sigHeader = req.headers['stripe-signature'] || req.headers['Stripe-Signature'];

  // Reject missing signatures with 400 regardless of configuration, so the
  // contract holds on any deployment (including before env vars are set).
  if (!sigHeader) {
    return res.status(400).json({ error: "Missing Stripe-Signature header" });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET env var");
    return res.status(500).json({ error: "Webhook is not configured yet." });
  }

  if (!verifySignature(rawBody, sigHeader, webhookSecret)) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const eventIso = isoFromUnix(event.created) || new Date().toISOString();
  const obj = (event.data && event.data.object) || {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const uid = obj.client_reference_id || (obj.metadata && obj.metadata.uid) || null;
        if (!uid) break;
        const customerId = obj.customer || null;
        const subscriptionId = obj.subscription || null;

        // Pull period end + price from the subscription when we can.
        let currentPeriodEnd = null;
        let priceId = null;
        if (subscriptionId && stripeKey) {
          const sub = await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`, stripeKey);
          if (sub.ok) {
            currentPeriodEnd = subPeriodEndIso(sub.data);
            const item = sub.data.items && sub.data.items.data && sub.data.items.data[0];
            priceId = item && item.price ? item.price.id : null;
          }
        }

        await upsertEntitlement({
          supabaseUrl, supabaseKey, uid, eventIso,
          patch: {
            status: 'active',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            price_id: priceId,
            current_period_end: currentPeriodEnd
          }
        });
        break;
      }

      case 'customer.subscription.updated': {
        const uid = obj.metadata && obj.metadata.uid;
        if (!uid) break;
        const status = mapStatus(obj.status);
        if (!status) break;
        const item = obj.items && obj.items.data && obj.items.data[0];
        await upsertEntitlement({
          supabaseUrl, supabaseKey, uid, eventIso,
          patch: {
            status,
            stripe_customer_id: obj.customer || null,
            stripe_subscription_id: obj.id || null,
            price_id: item && item.price ? item.price.id : null,
            current_period_end: subPeriodEndIso(obj)
          }
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const uid = obj.metadata && obj.metadata.uid;
        if (!uid) break;
        await upsertEntitlement({
          supabaseUrl, supabaseKey, uid, eventIso,
          patch: {
            status: 'canceled',
            stripe_subscription_id: obj.id || null,
            current_period_end: subPeriodEndIso(obj)
          }
        });
        break;
      }

      case 'invoice.payment_failed': {
        // Invoice events carry the customer id reliably but not our uid.
        await markPastDueByCustomer({
          supabaseUrl, supabaseKey, customerId: obj.customer || null, eventIso
        });
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (error) {
    // Return 500 so Stripe retries transient write failures.
    console.error("stripe-webhook handler error:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }

  return res.status(200).json({ received: true });
}
