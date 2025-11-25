export default async function handler(req, res) {
  console.log("DEBUG: Incoming request method:", req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- FIXED: Vercel requires explicit JSON parsing ----
    let body = {};
    try {
      body = await new Promise((resolve, reject) => {
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
        req.on("error", reject);
      });
    } catch (err) {
      console.log("DEBUG: Error reading request body:", err);
      body = {};
    }

    console.log("DEBUG: Parsed body:", body);

    const game = body?.game;
    if (!game) {
      console.log("DEBUG: Missing game data");
      return res.status(400).json({ error: "Missing game data" });
    }

    // ---- ENV ----
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

    // ---- Airtable URL ----
    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    // ---- Proper Airtable payload ----
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
      return res.status(200).json({
        success: true,
        id: data.records[0].id
      });
    } else {
      console.log("DEBUG: Airtable error response:", data);
      return res.status(500).json({ success: false, data });
    }
  } catch (err) {
    console.error("Airtable error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
