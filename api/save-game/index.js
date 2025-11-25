module.exports = async function handler(req, res) {
  console.log("DEBUG: Incoming request method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Log raw body
    console.log("DEBUG: Raw req.body:", req.body);

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch (err) {
      console.log("DEBUG: JSON parse error:", err);
      body = req.body;
    }

    console.log("DEBUG: Parsed body:", body);

    const game = body?.game;
    if (!game) {
      console.log("DEBUG: Missing game data");
      return res.status(400).json({ error: "Missing game data" });
    }

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

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    const payload = {
      records: [{ fields: game }]
    };

    console.log("DEBUG: Sending payload to Airtable:", JSON.stringify(payload));

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
    } else {
      return res.status(500).json({ success: false, data });
    }
  } catch (err) {
    console.error("Airtable error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
