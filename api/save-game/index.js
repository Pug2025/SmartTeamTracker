export default async function handler(req, res) {
  console.log("DEBUG: Incoming request method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
    }

  try {
    // --- Parse JSON body manually (Vercel quirk) ---
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch (err) {
          console.log("DEBUG: JSON parse error:", err);
          resolve({});
        }
      });
    });

    console.log("DEBUG: Parsed body:", body);

    // --- Accept BOTH formats ---
    // (1) Simple:   { game: {...fields} }
    // (2) Season:   { gameId, startedAt, savedAt, meta, aggregates, events }
    let recordFields = null;

    if (body.game) {
      // Simple payload from saveGameToAirtable()
      recordFields = body.game;
      console.log("DEBUG: Using simple game payload");
    } else if (body.gameId && body.meta && body.aggregates) {
      // Season payload from saveToSeason()
      console.log("DEBUG: Using SEASON payload");

      recordFields = {
        GameID: body.gameId,
        StartedAt: body.startedAt,
        SavedAt: body.savedAt,

        Opponent: body.meta.opponent || "",
        Level: body.meta.level || "",
        Date: body.meta.date || "",

        // Flatten key gameRow stats
        ...(body.aggregates.gameRow || {}),

        // Optional: include JSON blobs
        GoalieJSON: JSON.stringify(body.aggregates.goalie || {}),
        TeamJSON: JSON.stringify(body.aggregates.team || {}),
        EventsJSON: JSON.stringify(body.events || [])
      };
    }

    if (!recordFields) {
      console.log("DEBUG: Missing game data");
      return res.status(400).json({ error: "Missing game data" });
    }

    // Environment
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const token = process.env.AIRTABLE_PAT;

    console.log("DEBUG: env loaded?", {
      baseId: !!baseId,
      tableId: !!tableId,
      token: !!token
    });

    if (!baseId || !tableId || !token) {
      return res.status(500).json({ error: "Missing Airtable credentials" });
    }

    // --- Airtable API ---
    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;
    const payload = {
      records: [
        {
          fields: recordFields
        }
      ]
    };

    console.log("DEBUG: Sending payload to Airtable:", JSON.stringify(payload, null, 2));

    const response = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("DEBUG: Airtable response:", data);

    if (data?.records?.[0]?.id) {
      return res.status(200).json({ success: true, id: data.records[0].id });
    }

    return res.status(500).json({ success: false, data });
  } catch (err) {
    console.error("Airtable error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
