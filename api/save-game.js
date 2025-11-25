// /api/save-game.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
      return res.status(500).json({ error: "Missing Airtable credentials" });
    }

    const { game } = req.body;

    if (!game) {
      return res.status(400).json({ error: "Missing game data" });
    }

    // Airtable REST API endpoint for creating records
    const url = `https://api.airtable.com/v0/${baseId}/Games`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        records: [
          { fields: game }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error("Airtable error:", data.error);
      return res.status(500).json({ error: data.error });
    }

    return res.status(200).json({ success: true, id: data.records[0].id });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Unknown server error" });
  }
}
