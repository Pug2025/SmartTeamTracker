// api/create-checkout-session.js
// POST, auth required. Creates a Stripe Checkout Session for the $49/yr
// subscription and returns { url } for the client to redirect to.
//
// No Stripe SDK: we POST application/x-www-form-urlencoded bodies to the
// Stripe REST API with the secret key as a bearer token, matching the raw
// fetch house style used for Supabase and Firebase.
//
// The entitlement is never set here. This endpoint may pre-create the
// entitlements row to store the Stripe customer id, but only the webhook
// flips status to 'active'.

import { authenticateRequest } from './_auth.js';
import { checkRateLimit, sendRateLimited } from './_rate-limit.js';

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripePost(path, secretKey, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // Auth first, before any env/config checks, so an unauthenticated caller
  // always gets 401 (not a 500) even on a deployment where Stripe env vars
  // are not yet set.
  const auth = await authenticateRequest(req, res);
  if (auth === null) return; // invalid token — 401 already sent
  const uid = auth.uid;
  if (!uid) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Create an account before going Premium."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!stripeKey || !priceId) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID env vars");
    return res.status(500).json({ error: "Checkout is not configured yet." });
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Rate limit: 10 checkout attempts/min per uid.
  const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `checkout:${uid}`, limit: 10 });
  if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  try {
    // 1) Ensure a Stripe customer for this uid. Reuse the stored id if present.
    let customerId = null;
    try {
      const lookup = await fetch(
        `${supabaseUrl}/rest/v1/entitlements?uid=eq.${encodeURIComponent(uid)}&select=stripe_customer_id&limit=1`,
        { headers: sbHeaders }
      );
      if (lookup.ok) {
        const rows = await lookup.json();
        if (Array.isArray(rows) && rows.length && rows[0].stripe_customer_id) {
          customerId = rows[0].stripe_customer_id;
        }
      }
    } catch (_) { /* fall through to creating a customer */ }

    if (!customerId) {
      const created = await stripePost('/customers', stripeKey, { 'metadata[uid]': uid });
      if (!created.ok || !created.data.id) {
        console.error("Stripe customer create failed:", JSON.stringify(created.data));
        return res.status(502).json({ error: "Could not create billing profile." });
      }
      customerId = created.data.id;

      // Store the customer id (never status) so the webhook and future
      // checkouts can find it. Merge-duplicates preserves any existing status.
      await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
        method: "POST",
        headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ uid, stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      }).catch((e) => console.warn("entitlements customer upsert warning:", e));
    }

    // 2) Build the checkout session.
    const origin = (process.env.APP_BASE_URL
      || req.headers.origin
      || (req.headers.host ? `https://${req.headers.host}` : '')).replace(/\/$/, '');

    const session = await stripePost('/checkout/sessions', stripeKey, {
      'mode': 'subscription',
      'customer': customerId,
      'client_reference_id': uid,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'subscription_data[metadata][uid]': uid,
      'allow_promotion_codes': 'true',
      'success_url': `${origin}/?checkout=success`,
      'cancel_url': `${origin}/?checkout=cancel`
    });

    if (!session.ok || !session.data.url) {
      console.error("Stripe checkout session failed:", JSON.stringify(session.data));
      return res.status(502).json({ error: "Could not start checkout." });
    }

    return res.status(200).json({ url: session.data.url });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
