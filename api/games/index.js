export default async function handler(req, res) {
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
