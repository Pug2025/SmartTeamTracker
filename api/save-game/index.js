// api/save-game/index.js
// Version: v6.0.0 – Supabase edition
//
// Purpose:
// - Accept game data: { game: { ...stats } }
// - Store in Supabase with all stats in a flexible JSONB column
// - No allowlist needed — any new stat you track is saved automatically

export default async function handler(req, res) {
  // CORS & Method Check
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const payload = typeof req.body === "object" && req.body ? req.body : JSON.parse(await readBody(req));

    if (!payload || !payload.game || typeof payload.game !== "object") {
      return res.status(400).json({ error: "Invalid payload. Expected { game: {...} }" });
    }

    const game = payload.game;

    // Build the row: top-level columns for querying, everything else in data
    const row = {
      game_id: game.gameId || null,
      date: game.Date || null,
      opponent: game.Opponent || null,
      level: game.Level || null,
      user_id: game.user_id || null,
      team_id: game.team_id || null,
      data: game // store ALL stats — no allowlist, no schema changes needed
    };

    // Send to Supabase
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
    await syncOpponentLastPlayed({ supabaseUrl, supabaseKey, game }).catch((error) => {
      console.warn("Opponent sync warning:", error);
    });
    return res.status(200).json({ success: true, id: record.id });

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}

// Helper for reading raw request body if not pre-parsed
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body || "{}"));
  });
}

async function syncOpponentLastPlayed({ supabaseUrl, supabaseKey, game }) {
  const teamId = String(game.team_id || "").trim();
  const opponentName = String(game.Opponent || "").trim().replace(/\s+/g, " ");
  const userId = game.user_id ? String(game.user_id).trim() : null;
  const lastPlayedAt = String(game.Date || "").trim() || null;

  if (!teamId || !opponentName) return;

  const normalizedName = opponentName.toLowerCase();
  let lookupUrl = `${supabaseUrl}/rest/v1/opponents?select=id&team_id=eq.${encodeURIComponent(teamId)}&name_normalized=eq.${encodeURIComponent(normalizedName)}&limit=1`;
  lookupUrl += userId
    ? `&user_id=eq.${encodeURIComponent(userId)}`
    : `&user_id=is.null`;

  const lookupRes = await fetch(lookupUrl, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });
  const lookupData = await lookupRes.json().catch(() => ({}));

  if (!lookupRes.ok) {
    throw new Error(`Opponent lookup failed: ${JSON.stringify(lookupData)}`);
  }

  const now = new Date().toISOString();
  const patchBody = {
    name: opponentName,
    last_used_at: now
  };
  if (lastPlayedAt) patchBody.last_played_at = lastPlayedAt;

  if (Array.isArray(lookupData) && lookupData.length) {
    const recordId = lookupData[0].id;
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/opponents?id=eq.${encodeURIComponent(recordId)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(patchBody)
      }
    );
    if (!patchRes.ok) {
      const patchData = await patchRes.json().catch(() => ({}));
      throw new Error(`Opponent update failed: ${JSON.stringify(patchData)}`);
    }
    return;
  }

  const insertBody = {
    user_id: userId,
    team_id: teamId,
    name: opponentName,
    last_used_at: now,
    last_played_at: lastPlayedAt
  };
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/opponents`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(insertBody)
  });

  if (!insertRes.ok) {
    const insertData = await insertRes.json().catch(() => ({}));
    throw new Error(`Opponent insert failed: ${JSON.stringify(insertData)}`);
  }
}
