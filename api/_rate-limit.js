// api/_rate-limit.js
// Lightweight rate limiting using Supabase as the backing store.
// Tracks request counts in a `rate_limits` table (auto-created via upsert).
//
// Table schema (create in Supabase if it doesn't exist):
//   CREATE TABLE IF NOT EXISTS rate_limits (
//     key TEXT PRIMARY KEY,
//     count INT DEFAULT 1,
//     window_start TIMESTAMPTZ DEFAULT now()
//   );

const WINDOW_MS = 60 * 1000; // 1-minute window

/**
 * Check rate limit for a given key.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 *
 * If the rate_limits table doesn't exist or Supabase is unreachable,
 * fails open (allows the request) to avoid blocking legitimate users.
 */
export async function checkRateLimit({ supabaseUrl, supabaseKey, key, limit }) {
  if (!supabaseUrl || !supabaseKey || !key) return { allowed: true };

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  try {
    // Fetch current record
    const getRes = await fetch(
      `${supabaseUrl}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}&select=count,window_start&limit=1`,
      { headers }
    );

    if (!getRes.ok) return { allowed: true }; // Fail open

    const rows = await getRes.json();
    const now = Date.now();

    if (rows.length === 0) {
      // First request — insert
      await fetch(`${supabaseUrl}/rest/v1/rate_limits`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ key, count: 1, window_start: new Date().toISOString() })
      });
      return { allowed: true };
    }

    const row = rows[0];
    const windowStart = new Date(row.window_start).getTime();
    const elapsed = now - windowStart;

    if (elapsed > WINDOW_MS) {
      // Window expired — reset
      await fetch(`${supabaseUrl}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ count: 1, window_start: new Date().toISOString() })
      });
      return { allowed: true };
    }

    if (row.count >= limit) {
      const retryAfter = Math.ceil((WINDOW_MS - elapsed) / 1000);
      return { allowed: false, retryAfter };
    }

    // Increment count
    await fetch(`${supabaseUrl}/rest/v1/rate_limits?key=eq.${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ count: row.count + 1 })
    });
    return { allowed: true };

  } catch (_) {
    return { allowed: true }; // Fail open on errors
  }
}

/**
 * Helper to send a 429 response.
 */
export function sendRateLimited(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Too many requests', retryAfter });
}
