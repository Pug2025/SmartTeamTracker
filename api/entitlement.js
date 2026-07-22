// api/entitlement.js
// GET  the signed-in caller's entitlement. Auth required.
// POST { action:'redeem', code } to redeem a beta access code for free premium
//      ('comp'). Auth required. No Stripe, no card. Valid codes are configured
//      in the COMP_CODES env var (comma-separated, case-insensitive). An empty
//      or missing COMP_CODES means no code is valid (safe default).
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
    return handleRedeem(req, res, uid);
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

// Redeem a beta access code -> grant 'comp' (free premium, no expiry, no Stripe).
// The valid code is the authorization: without one, nothing is granted, so a
// client can never comp itself by calling this.
async function handleRedeem(req, res, uid) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Rate limit attempts per uid so a signed-in user cannot brute-force codes.
  const rl = await checkRateLimit({ supabaseUrl, supabaseKey, key: `redeem:${uid}`, limit: 12 });
  if (!rl.allowed) return sendRateLimited(res, rl.retryAfter);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  if (body.action !== 'redeem') {
    return res.status(400).json({ error: "Unsupported action" });
  }
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
