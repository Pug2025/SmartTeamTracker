// api/save-game/index.js

// 1. CONFIGURATION: The strict Allowlist matches your Airtable Schema exactly.
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
  "Smothers",
  "BadRebounds",
  "BigSaves",
  "SoftGoals",
  "GA_BA",
  "GA_DZ",
  "GA_BR",
  "GA_Other",
  // Optional: only keep this if you actually create a LONG TEXT field called JSONDump
  "JSONDump"
];

// 2. HELPER: Manual JSON body parsing for Vercel
const parseBody = async (req) => {
  // If some middleware already parsed JSON, use it
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
    console.log("DEBUG: Received payload keys:", Object.keys(payload));

    let candidateData = {};
    let saveType = "Unknown";

    // --- SCENARIO 1: Simple Game Save ---
    // Payload: { "game": { "Date": "...", "GA_BA": "..." } }
    if (payload.game && typeof payload.game === "object") {
      saveType = "Simple";
      candidateData = { ...payload.game };
    }

    // --- SCENARIO 2: Season Save ---
    // Payload: { gameId, meta: {...}, aggregates: { gameRow: {...} }, events: [...] }
    else if (
      payload.aggregates &&
      payload.aggregates.gameRow &&
      typeof payload.aggregates.gameRow === "object"
    ) {
      saveType = "Season";
      const row = payload.aggregates.gameRow;
      const meta = payload.meta || {};

      // 1. Flatten and map keys from gameRow/meta → Airtable columns
      candidateData = {
        Date: meta.date || row.date,
        Opponent: meta.opponent || row.opponent,
        Level: meta.level || row.level,
        TeamScore: row.teamScore,
        GoalieScore: row.goalieScore,
        SF: row.SF,
        SA: row.SA,
        GF: row.GF,
        GA: row.GA,
        BreakawaysAgainst: row.breakawaysAgainst,
        DZTurnovers: row.dzTurnovers,
        Smothers: row.smothers,
        BadRebounds: row.badRebounds,
        BigSaves: row.bigSaves,
        SoftGoals: row.softGoals,

        // CSV → Airtable mapping
        GA_BA: row.GA_off_BA,
        GA_DZ: row.GA_off_DZ,
        GA_BR: row.GA_off_BR,
        GA_Other: row.GA_other
      };

      // 2. Optional: dump full rich history into JSONDump if that field exists in Airtable
      if (AIRTABLE_ALLOWED_FIELDS.includes("JSONDump")) {
        candidateData.JSONDump = JSON.stringify(payload);
      }
    } else {
      console.warn("DEBUG: Unrecognized payload structure:", payload);
      return res.status(400).json({ error: "Invalid payload structure" });
    }

    console.log(`DEBUG: Detected Save Type: ${saveType}`);

    // --- STEP 3: Strict Filtering (Guardrails) ---
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

    // --- STEP 4: Send to Airtable ---
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const pat = process.env.AIRTABLE_PAT;

    if (!baseId || !tableId || !pat) {
      console.error("DEBUG: Missing Airtable env vars", { baseId: !!baseId, tableId: !!tableId, pat: !!pat });
      return res.status(500).json({ error: "Server configuration error (Airtable env vars)" });
    }

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;

    const airtablePayload = {
      records: [
        {
          fields: finalFields
        }
      ],
      typecast: true // Let Airtable coerce types where possible
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
        details: data.error || data
      });
    }

    const recordId = data?.records?.[0]?.id;
    console.log("DEBUG: Airtable Success ID:", recordId);

    return res.status(200).json({ success: true, id: recordId });
  } catch (error) {
    console.error("DEBUG: Server Exception:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
