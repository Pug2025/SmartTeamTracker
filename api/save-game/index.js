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
  "JSONDump" // <--- Ensure this column exists in Airtable
];

// 2. HELPER: Manual JSON body parsing for Vercel
const parseBody = async (req) => {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } 
      catch (e) { resolve({}); }
    });
  });
};

export default async function handler(req, res) {
  // CORS & Method Check
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = await parseBody(req);
    console.log("DEBUG: Received Payload Keys:", Object.keys(payload));

    let candidateData = {};
    let saveType = "Unknown";

    // --- SCENARIO 1: Simple Game Save ---
    // Payload: { "game": { "Date": "...", "GA_BA": "..." } }
    // The frontend already formats this perfectly for Airtable.
    if (payload.game) {
      saveType = "Simple";
      candidateData = { ...payload.game };
    } 

    // --- SCENARIO 2: Season Save (The Complex One) ---
    // Payload: { gameId, meta: {...}, aggregates: { gameRow: { date, opponent, GA_off_BA... } }, events: [...] }
    // We must MAP the CSV-style keys to Airtable keys.
    else if (payload.aggregates && payload.aggregates.gameRow) {
      saveType = "Season";
      const row = payload.aggregates.gameRow;
      const meta = payload.meta || {};

      // 1. Flatten and Map keys
      candidateData = {
        // Direct maps (assuming row keys are lowercase/camelCase from frontend buildGameRow)
        Date:              meta.date || row.date,
        Opponent:          meta.opponent || row.opponent,
        Level:             meta.level || row.level,
        TeamScore:         row.teamScore,
        GoalieScore:       row.goalieScore,
        SF:                row.SF,
        SA:                row.SA,
        GF:                row.GF,
        GA:                row.GA,
        BreakawaysAgainst: row.breakawaysAgainst,
        DZTurnovers:       row.dzTurnovers,
        Smothers:          row.smothers,
        BadRebounds:       row.badRebounds,
        BigSaves:          row.bigSaves,
        SoftGoals:         row.softGoals,
        
        // MAPPING: Convert CSV keys (GA_off_BA) to Airtable keys (GA_BA)
        GA_BA:             row.GA_off_BA,
        GA_DZ:             row.GA_off_DZ,
        GA_BR:             row.GA_off_BR,
        GA_Other:          row.GA_other, // note lowercase 'other' in frontend CSV logic
      };

      // 2. Dump the full rich history into the JSONDump column
      candidateData.JSONDump = JSON.stringify(payload);
    } 
    else {
      console.warn("DEBUG: Unrecognized payload structure");
      return res.status(400).json({ error: "Invalid payload structure" });
    }

    console.log(`DEBUG: Detected Save Type: ${saveType}`);

    // --- STEP 3: Strict Filtering (The Guardrails) ---
    // Only pass fields that exist in AIRTABLE_ALLOWED_FIELDS
    const finalFields = {};
    AIRTABLE_ALLOWED_FIELDS.forEach((field) => {
      // Check if key exists (even if value is 0 or null)
      if (candidateData[field] !== undefined) {
        finalFields[field] = candidateData[field];
      }
    });

    console.log("DEBUG: Sending to Airtable:", JSON.stringify(finalFields, null, 2));

    // --- STEP 4: Send to Airtable ---
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const pat = process.env.AIRTABLE_PAT;

    if (!baseId || !tableId || !pat) {
      console.error("DEBUG: Missing Env Vars");
      return res.status(500).json({ error: "Server Configuration Error" });
    }

    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: finalFields,
        typecast: true // Auto-convert strings to Select options/Dates
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("DEBUG: Airtable Error:", JSON.stringify(data));
      return res.status(response.status).json({ 
        error: "Airtable Save Failed", 
        details: data.error 
      });
    }

    console.log("DEBUG: Airtable Success ID:", data.id);
    return res.status(200).json({ success: true, id: data.id });

  } catch (error) {
    console.error("DEBUG: Server Exception:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}
