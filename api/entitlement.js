// api/entitlement.js
// GET the signed-in caller's entitlement. Auth required.
//
// Returns { status, isPremium, currentPeriodEnd } for the Firebase-verified
// uid. The client calls this on auth ready to drive UI gating only; it never
// protects paid value on its own (every gated server op re-checks
// getEntitlement independently). Guests get 401 and are treated as non-premium
// by the client without calling this.

import { authenticateRequest } from './_auth.js';
import { getEntitlement } from './_entitlement.js';

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  // authenticateRequest sends its own 401 on an invalid token (returns null).
  // A missing token yields { uid: null }; we reject those here so the contract
  // is "auth required".
  const auth = await authenticateRequest(req, res);
  if (auth === null) return;
  const uid = auth.uid;
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized", message: "Sign in required" });
  }

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
