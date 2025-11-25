export default async function handler(req, res) {
  console.log("DEBUG: Incoming request method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Ensure body is parsed
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        console.log("DEBUG: JSON parse error:", err);
      }
    }

    console.log("DEBUG: Parsed body:", body);

    const game = body?.game;
    if (!game) {
      console.log("DEBUG: Missing game data");
      return res.status(400).json({ error: "Missing game data" });
    }

    // Airtable credentials
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const token = process.env.AIRTABLE_PAT;

    console.log("DEBUG: env loaded:", {
      baseId: !!baseId,
      tableId: !!tableId,
      token: !!token
    });

    if (!baseId || !tableId || !token) {
      return res.status(500).json({ error: "Missing Airtable credentials" });
    }

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    // Airtable requires { records: [{ fields: { ... } }] }
    const payload = {
      records: [
        {
          fields: game
        }
      ]
    };

    console.log("DEBUG → Sending to Airtable:", payload);

    const airtableRes = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await airtableRes.json();
    console.log("DEBUG → Airtable response:", data);

    if (data?.records?.[0]?.id) {
      return res.status(200).json({
        success: true,
        id: data.records[0].id
      });
    }

    return res.status(500).json({
      success: false,
      error: "Airtable insert failed",
      data
    });

  } catch (err) {
    console.error("FATAL ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
