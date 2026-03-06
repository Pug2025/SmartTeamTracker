export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (req.method === "GET") {
    try {
      const teamId = req.query.team_id || null;
      const userId = req.query.user_id || null;
      const limit = Math.min(Number(req.query.limit) || 25, 100);

      if (!teamId) {
        return res.status(400).json({ error: "Missing team id" });
      }

      let queryUrl = `${supabaseUrl}/rest/v1/opponents?select=id,name,last_used_at,last_played_at&order=last_used_at.desc&limit=${limit}&team_id=eq.${encodeURIComponent(teamId)}`;
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

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: "Fetch failed", details: data });
      }

      return res.status(200).json({ success: true, opponents: data });
    } catch (error) {
      console.error("Server error:", error);
      return res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
  }

  if (req.method === "POST") {
    try {
      const payload = typeof req.body === "object" && req.body ? req.body : JSON.parse(await readBody(req));
      const opponent = payload && payload.opponent;

      if (!opponent || typeof opponent !== "object") {
        return res.status(400).json({ error: "Invalid payload. Expected { opponent: {...} }" });
      }

      const teamId = String(opponent.team_id || "").trim();
      const name = String(opponent.name || "").trim();
      const userId = opponent.user_id ? String(opponent.user_id).trim() : null;
      const lastPlayedAt = typeof opponent.last_played_at === "string" && opponent.last_played_at.trim()
        ? opponent.last_played_at.trim()
        : null;

      if (!teamId || !name) {
        return res.status(400).json({ error: "team_id and name are required" });
      }

      const normalizedName = name.toLowerCase();
      let lookupUrl = `${supabaseUrl}/rest/v1/opponents?select=id,name,last_played_at,last_used_at&team_id=eq.${encodeURIComponent(teamId)}&name_normalized=eq.${encodeURIComponent(normalizedName)}&limit=1`;
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
      const lookupData = await lookupRes.json();

      if (!lookupRes.ok) {
        return res.status(lookupRes.status).json({ error: "Lookup failed", details: lookupData });
      }

      const now = new Date().toISOString();
      if (Array.isArray(lookupData) && lookupData.length) {
        const existing = lookupData[0];
        const patchBody = {
          name,
          last_used_at: now
        };
        if (lastPlayedAt) patchBody.last_played_at = lastPlayedAt;

        const patchRes = await fetch(
          `${supabaseUrl}/rest/v1/opponents?id=eq.${encodeURIComponent(existing.id)}`,
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
        const patchData = await patchRes.json();

        if (!patchRes.ok) {
          return res.status(patchRes.status).json({ error: "Update failed", details: patchData });
        }

        const record = Array.isArray(patchData) ? patchData[0] : patchData;
        return res.status(200).json({ success: true, opponent: record });
      }

      const insertBody = {
        user_id: userId,
        team_id: teamId,
        name,
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
      const insertData = await insertRes.json();

      if (!insertRes.ok) {
        return res.status(insertRes.status).json({ error: "Insert failed", details: insertData });
      }

      const record = Array.isArray(insertData) ? insertData[0] : insertData;
      return res.status(200).json({ success: true, opponent: record });
    } catch (error) {
      console.error("Server error:", error);
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
