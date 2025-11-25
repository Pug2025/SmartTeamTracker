module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Ensure body is parsed
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      body = req.body;
    }

    const game = body?.game;

    if (!game) {
      return res.status(400).json({ error: "Missing game data" });
    }

    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const token = process.env.AIRTABLE_PAT;

    if (!baseId || !tableId || !token) {
      return res.status(500).json({ error: "Missing Airtable credentials" });
    }

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    const response = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: game }),
    });

    const data = await response.json();
    console.log("Airtable response:", data);

    if (data?.id) {
      return res.status(200).json({ success: true, id: data.id });
    } else {
      return res.status(500).json({ success: false, data });
    }
  } catch (err) {
    console.error("Airtable error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
