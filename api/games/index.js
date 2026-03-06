export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (req.method === "GET") {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      const userId = req.query.user_id || null;

      // Build query URL — filter by user_id if provided
      let queryUrl = `${supabaseUrl}/rest/v1/games?select=id,game_id,date,opponent,level,data&order=created_at.desc&limit=${limit}`;
      if (userId) {
        queryUrl += `&user_id=eq.${encodeURIComponent(userId)}`;
      }
      const teamId = req.query.team_id || null;
      if (teamId) {
        queryUrl += `&team_id=eq.${encodeURIComponent(teamId)}`;
      }

      const response = await fetch(
        queryUrl,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: "Fetch failed", details: data });
      }

      return res.status(200).json({ success: true, games: data });
    } catch (error) {
      console.error("Server error:", error);
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = req.query.id;
      const teamId = req.query.team_id || null;
      const userId = req.query.user_id || null;
      const opponent = req.query.opponent || null;

      if (id) {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(id)}`,
          {
            method: "DELETE",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return res.status(response.status).json({ error: "Delete failed", details: data });
        }

        return res.status(200).json({ success: true });
      }

      if (!teamId) {
        return res.status(400).json({ error: "Missing game id or team id" });
      }

      if (opponent) {
        const matches = await fetchGamesForOpponent({ supabaseUrl, supabaseKey, teamId, userId, opponent });
        if (!matches.length) {
          return res.status(200).json({ success: true, deleted: 0 });
        }

        await deleteGamesByIds({ supabaseUrl, supabaseKey, ids: matches.map((game) => game.id) });
        return res.status(200).json({ success: true, deleted: matches.length });
      }

      let deleteUrl = `${supabaseUrl}/rest/v1/games?team_id=eq.${encodeURIComponent(teamId)}`;
      if (userId) {
        deleteUrl += `&user_id=eq.${encodeURIComponent(userId)}`;
      }

      const response = await fetch(
        deleteUrl,
        {
          method: "DELETE",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: "Reset failed", details: data });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Server error:", error);
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

async function fetchGamesForOpponent({ supabaseUrl, supabaseKey, teamId, userId, opponent }) {
  const normalizedOpponent = normalizeOpponentName(opponent);
  let queryUrl = `${supabaseUrl}/rest/v1/games?select=id,opponent,data&order=created_at.desc&limit=1000&team_id=eq.${encodeURIComponent(teamId)}`;
  queryUrl += userId
    ? `&user_id=eq.${encodeURIComponent(userId)}`
    : `&user_id=is.null`;

  const response = await fetch(queryUrl, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    }
  });
  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(`Fetch failed: ${JSON.stringify(data)}`);
  }

  const games = Array.isArray(data) ? data : [];
  return games.filter((game) => {
    const sourceName = normalizeOpponentName(
      (game && game.data && game.data.Opponent) || (game && game.opponent) || ""
    );
    return sourceName === normalizedOpponent;
  });
}

async function deleteGamesByIds({ supabaseUrl, supabaseKey, ids }) {
  for (const id of ids) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(`Delete failed: ${JSON.stringify(data)}`);
    }
  }
}

function normalizeOpponentName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
