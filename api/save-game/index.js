module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ------- Parse Body Safely -------
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error("Bad JSON body:", e);
        return res.status(400).json({ error: "Invalid JSON" });
      }
    }

    const game = body?.game;
    if (!game || typeof game !== "object") {
      return res.status(400).json({ error: "Missing or invalid game object" });
    }

    console.log("Incoming game data:", game);

    // ------- Environment Vars -------
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const token = process.env.AIRTABLE_PAT;

    if (!baseId || !tableId || !token) {
      console.error("Missing environment variables");
      return res.status(500).json({ error: "Missing Airtable credentials" });
    }

    // ------- Airtable URL -------
    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    // ------- Airtable Payload (CORRECT FORMAT) -------
    const payload = {
      records: [
        {
          fields: { ...game }
        }
      ]
    };

    console.log("Sending payload to Airtable:", payload);

    // ------- Send to Airtable -------
    const response = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Airtable response:", data);

    // ------- Success? -------
    if (data?.records?.[0]?.id) {
      return res.status(200).json({
        success: true,
        id: data.records[0].id
      });
    }

    // Airtable error surfaced
    return res.status(500).json({
      success: false,
      airtable: data
    });

  } catch (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
};
