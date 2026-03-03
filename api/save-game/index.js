// api/save-game/index.js
// Version: v6.0.0 – Supabase edition
//
// Purpose:
// - Accept game data: { game: { ...stats } }
// - Store in Supabase with all stats in a flexible JSONB column
// - No allowlist needed — any new stat you track is saved automatically

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const payload = typeof req.body === "object" && req.body ? req.body : JSON.parse(await readBody(req));

    if (!payload || !payload.game || typeof payload.game !== "object") {
      return res.status(400).json({ error: "Invalid payload. Expected { game: {...} }" });
    }

    const game = payload.game;

    const row = {
      game_id: game.gameId || null,
      date: game.Date || null,
      opponent: game.Opponent || null,
      level: game.Level || null,
      data: game
    };

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/games`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(row)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Supabase error:", JSON.stringify(data));
      return res.status(response.status).json({ error: "Save failed", details: data });
    }

    const record = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({ success: true, id: record.id });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body || "{}"));
  });
}
