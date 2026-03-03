export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (req.method === "GET") {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      const response = await fetch(
        `${supabaseUrl}/rest/v1/games?select=id,game_id,date,opponent,level,data&order=created_at.desc&limit=${limit}`,
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
      if (!id) {
        return res.status(400).json({ error: "Missing game id" });
      }

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
    } catch (error) {
      console.error("Server error:", error);
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
