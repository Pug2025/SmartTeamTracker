export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ message: "Missing Supabase config" });
    }

    // Quick check: hit Supabase to confirm connectivity
    const response = await fetch(`${supabaseUrl}/rest/v1/games?select=id&limit=1`, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    });

    if (response.ok) {
      return res.status(200).json({ message: "SmartTeamTracker API is working" });
    } else {
      return res.status(502).json({ message: "Database unreachable" });
    }
  } catch (error) {
    return res.status(502).json({ message: "Database unreachable" });
  }
}
