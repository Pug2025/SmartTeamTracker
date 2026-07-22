// api/_entitlement.js
// Shared entitlement lookup for gated endpoints.
//
// Reads the Supabase `entitlements` table with the anon key (mirrors the
// pattern in _rate-limit.js). This is the single server-side source of truth
// for whether a Firebase uid is premium. It is READ here by every gated
// endpoint; it is WRITTEN only by api/stripe-webhook.js.
//
// Table schema (Jamie creates this in Supabase; see MONETIZATION_PLAN.md #1):
//   CREATE TABLE IF NOT EXISTS entitlements (
//     uid TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free',
//     stripe_customer_id TEXT, stripe_subscription_id TEXT, price_id TEXT,
//     current_period_end TIMESTAMPTZ, last_event_at TIMESTAMPTZ,
//     created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
//   );

// Grace window applied past current_period_end before access locks. Covers
// webhook lag and a short past_due grace before we re-lock (see plan #6).
const GRACE_MS = 24 * 60 * 60 * 1000; // 1 day

// Pure: given an entitlements row (or null), decide premium.
//   'comp'   -> premium, no expiry (manual/grandfather grant)
//   'active' / 'past_due' -> premium while now < current_period_end + grace
//   anything else (free, canceled, missing) -> not premium
export function computeIsPremium(row) {
  if (!row) return false;
  const status = row.status;
  if (status === 'comp') return true;
  if (status === 'active' || status === 'past_due') {
    const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
    // An 'active' row whose period end has not been recorded yet still counts
    // (the webhook flipped it to active); 'past_due' needs a real end date.
    if (Number.isNaN(end)) return status === 'active';
    return Date.now() < end + GRACE_MS;
  }
  return false;
}

// Fetch the entitlement for a verified uid. Returns a safe, non-premium
// default on any problem (no uid, missing config, missing table, network
// error) so the fail-safe is always "free" — we never leak paid value on a
// read failure.
export async function getEntitlement(uid) {
  const fallback = { status: 'free', isPremium: false, currentPeriodEnd: null };
  if (!uid) return fallback;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return fallback;

  try {
    const url = `${supabaseUrl}/rest/v1/entitlements`
      + `?uid=eq.${encodeURIComponent(uid)}`
      + `&select=status,current_period_end,stripe_customer_id,stripe_subscription_id`
      + `&limit=1`;
    const res = await fetch(url, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok) return fallback; // e.g. table not created yet -> treat as free

    const rows = await res.json();
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return fallback;

    return {
      status: row.status || 'free',
      isPremium: computeIsPremium(row),
      currentPeriodEnd: row.current_period_end || null
    };
  } catch (_) {
    return fallback; // fail closed to non-premium
  }
}
