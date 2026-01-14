// api/save-game/index.js
// Version: v5.1.0 – keep in sync with app version
//
// Purpose:
// - Accept ONLY the simple save payload: { game: { ...AirtableFields } }
// - Strict allowlist filtering to match Airtable columns
// - (Optional) JSONDump support if the field exists

// 1) CONFIGURATION: Strict allowlist must match Airtable field names exactly.
const AIRTABLE_ALLOWED_FIELDS = [
  "Date",
  "Opponent",
  "Level",
  "TeamScore",
  "GoalieScore",
  "SF",
  "SA",
  "GF",
  "GA",
  "BreakawaysAgainst",
  "DZTurnovers",
  "BreakawaysFor",
  "OddManRushFor",
  "Smothers",
  "BadRebounds",
  "BigSaves",
  "SoftGoals",
  "GA_BA",
  "GA_DZ",
  "GA_BR",
  "GA_Other",
  // Optional: keep only if you have a LONG TEXT field in Airtable named JSONDump
  "JSONDump"
];

// 2) HELPER: Manual JSON body parsing (Vercel/Node)
const parseBody = async (req) => {
  // If middleware already parsed JSON, use it
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return req.body;
  }

  // Otherwise, manually read the stream
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        console.error("DEBUG: JSON parse error:", e);
        resolve({});
      }
    });
  });
};

export default async function handler(req, res) {
  // CORS & Method Check
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const payload = await parseBody(req);
    console.log("DEBUG: Received payload keys:", Object.keys(payload || {}));

    // We now accept ONLY: { game: { ... } }
    if (!payload || !payload.game || typeof payload.game !== "object") {
      console.warn("DEBUG: Invalid payload structure. Expected { game: {...} }");
      return res.status(400).json({ error: "Invalid payload structure. Expected { game: {...} }" });
    }

    // Candidate data is the game object
    const candidateData = { ...payload.game };

    // Optional JSONDump: store raw payload/game for debugging if the field exists
    if (AIRTABLE_ALLOWED_FIELDS.includes("JSONDump")) {
      // You can choose one of these:
      // 1) Dump only the game object:
      candidateData.JSONDump = JSON.stringify(payload.game);
      // 2) Or dump the entire payload:
      // candidateData.JSONDump = JSON.stringify(payload);
    }

    // --- Strict Filtering (Guardrails) ---
    const finalFields = {};
    AIRTABLE_ALLOWED_FIELDS.forEach((field) => {
      if (candidateData[field] !== undefined) {
        finalFields[field] = candidateData[field];
      }
    });

    console.log("DEBUG: Final fields going to Airtable:", JSON.stringify(finalFields, null, 2));

    if (Object.keys(finalFields).length === 0) {
      console.warn("DEBUG: No allowed Airtable fields present in candidateData.");
      return res.status(400).json({ error: "No allowed Airtable fields in payload." });
    }

    // --- Send to Airtable ---
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const pat = process.env.AIRTABLE_PAT;

    if (!baseId || !tableId || !pat) {
      console.error("DEBUG: Missing Airtable env vars", {
        baseId: !!baseId,
        tableId: !!tableId,
        pat: !!pat
      });
      return res
        .status(500)
        .json({ error: "Server configuration error (Airtable env vars)" });
    }

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    const airtablePayload = {
      records: [
        {
          fields: finalFields
        }
      ],
      typecast: true
    };

    console.log("DEBUG: Sending payload to Airtable:", JSON.stringify(airtablePayload, null, 2));

    const response = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(airtablePayload)
    });

    const data = await response.json();
    console.log("DEBUG: Airtable status / response:", response.status, JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("DEBUG: Airtable Error:", JSON.stringify(data));
      return res.status(response.status).json({
        error: "Airtable Save Failed",
        details: data?.error || data
      });
    }

    const recordId = data?.records?.[0]?.id;
    console.log("DEBUG: Airtable Success ID:", recordId);

    return res.status(200).json({ success: true, id: recordId });
  } catch (error) {
    console.error("DEBUG: Server Exception:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
}
