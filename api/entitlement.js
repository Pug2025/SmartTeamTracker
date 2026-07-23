// api/entitlement.js
// Account endpoint. Auth required for every method.
//
// GET                                the signed-in caller's entitlement.
// POST { action:'redeem', code }      redeem a beta access code for free premium
//      ('comp'). No Stripe, no card. Valid codes come from the COMP_CODES env
//      var (comma-separated, case-insensitive); empty or missing means no code
//      is valid (safe default).
// POST { action:'delete-account' }    permanently delete every row this uid
//      owns. The Firebase login itself is removed client-side first (see
//      deleteAuthAccount in js/auth.js), so this only purges stored data.
//
// The account actions live here rather than in their own files because the
// Vercel Hobby plan caps a deployment at 12 Serverless Functions and this
// project sits at that limit.
//
// GET returns { status, isPremium, currentPeriodEnd } for the Firebase-verified
// uid. The client calls it on auth ready to drive UI gating only; it never
// protects paid value on its own (every gated server op re-checks
// getEntitlement independently). Guests get 401 and are treated as non-premium
// by the client without calling this.

import { authenticateRequest } from './_auth.js';
import { getEntitlement } from './_entitlement.js';
import { checkRateLimit, sendRateLimited } from './_rate-limit.js';

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth required for every method here.
  const auth = await authenticateRequest(req, res);
  if (auth === null) return; // invalid token — 401 already sent
  const uid = auth.uid;
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized", message: "Sign in required" });
  }

  if (req.method === "GET") {
    try {
      const ent = await getEntitlement(uid);
      return res.status(200).json({
        status: ent.status,
        isPremium: ent.isPremium,
        currentPeriodEnd: ent.currentPeriodEnd
      });
    } catch (error) {
      console.error("entitlement error:", error);
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};
    if (body.action === 'redeem') return handleRedeem(req, res, uid, body);
    if (body.action === 'delete-account') return handleDeleteAccount(req, res, uid);
    return res.status(400).json({ error: "Unsupported action" });
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

// Redeem a beta access code -> grant 'comp' (free premium, no expiry, no Stripe).
// The valid code is the authorization: without one, nothing is granted, so a
// client can never comp itself by calling this.
async function handleRedeem(req, res, uid, body) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Rate limit attempts per uid so a signed-in user cannot brute-force codes.
  const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `redeem:${uid}`, limit: 12 });
  if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

  const submitted = typeof body.code === 'string' ? body.code.trim() : '';
  if (!submitted) {
    return res.status(400).json({ error: "Enter your access code." });
  }

  // Case-insensitive match against configured codes.
  const configured = String(process.env.COMP_CODES || '')
    .split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase());
  if (!configured.includes(submitted.toLowerCase())) {
    return res.status(400).json({ error: "That access code is not valid." });
  }

  // Grant comp. merge-duplicates flips status to 'comp' while preserving any
  // existing columns (e.g. a stripe_customer_id) on the row.
  try {
    const sbRes = await fetch(`${supabaseUrl}/rest/v1/entitlements`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ uid, status: 'comp', updated_at: new Date().toISOString() })
    });
    if (!sbRes.ok) {
      const detail = await sbRes.text().catch(() => '');
      console.error("comp redeem upsert failed:", sbRes.status, detail);
      return res.status(502).json({ error: "Could not apply your code. Please try again." });
    }
  } catch (error) {
    console.error("redeem error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  return res.status(200).json({ success: true, status: 'comp', isPremium: true });
}

// Permanently delete every row this uid owns. Called after the Firebase login
// has already been deleted client-side; the ID token stays cryptographically
// valid until it expires, which is what authorises this call.
//
// live_games is intentionally not purged: it is keyed by share_code/game_id
// rather than by user, and those rows are ephemeral share sessions.
async function handleDeleteAccount(req, res, uid) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `delacct:${uid}`, limit: 5 });
  if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // Every table holding this user's data, with the column carrying the uid.
  const targets = [
    { table: 'games', col: 'user_id' },
    { table: 'teams', col: 'user_id' },
    { table: 'opponents', col: 'user_id' },
    { table: 'entitlements', col: 'uid' }
  ];

  const failed = [];
  for (const t of targets) {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/${t.table}?${t.col}=eq.${encodeURIComponent(uid)}`,
        { method: "DELETE", headers }
      );
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error(`delete-account: ${t.table} failed`, r.status, detail);
        failed.push(t.table);
      }
    } catch (error) {
      console.error(`delete-account: ${t.table} error`, error);
      failed.push(t.table);
    }
  }

  if (failed.length) {
    return res.status(502).json({ error: "Some data could not be deleted.", tables: failed });
  }
  return res.status(200).json({ success: true });
}
