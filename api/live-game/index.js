// api/live-game/index.js
// Live spectator mode – upsert / read / delete live game state
//
// PUT    – Coach pushes live state: { share_code, game_id, user_id, state }
// GET    – Spectator fetches current state: ?code=ABC123
// DELETE – Coach ends live share: ?code=ABC123

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // GET – spectator fetches live game state
  if (req.method === "GET") {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "Missing share code" });

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/live_games?share_code=eq.${encodeURIComponent(code)}&select=share_code,game_id,state,updated_at`,
        { headers }
      );
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: "Fetch failed", details: data });
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({ error: "Game not found or has ended" });
      }
      return res.status(200).json({ success: true, game: data[0] });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  // PUT – coach upserts live game state
  if (req.method === "PUT") {
    try {
      const payload = typeof req.body === "object" && req.body ? req.body : JSON.parse(await readBody(req));
      const { share_code, game_id, user_id, state } = payload || {};

      if (!share_code || !state) {
        return res.status(400).json({ error: "Missing share_code or state" });
      }

      const row = {
        share_code,
        game_id: game_id || null,
        user_id: user_id || null,
        state,
        updated_at: new Date().toISOString()
      };

      // Upsert on share_code (primary key)
      const response = await fetch(
        `${supabaseUrl}/rest/v1/live_games`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Prefer": "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify(row)
        }
      );

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: "Upsert failed", details: data });

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  // DELETE – coach ends live share
  if (req.method === "DELETE") {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "Missing share code" });

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/live_games?share_code=eq.${encodeURIComponent(code)}`,
        { method: "DELETE", headers }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: "Delete failed", details: data });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body || "{}"));
  });
}
