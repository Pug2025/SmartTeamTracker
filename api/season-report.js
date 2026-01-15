const OpenAI = require("openai");

// --- Airtable helpers ---
async function airtableFetchAllGames() {
  // IMPORTANT:
  // Use the SAME env var names your /api/save-game route already uses.
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;       // or AIRTABLE_API_KEY
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;       // or whatever you use

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
    throw new Error("Missing Airtable env vars");
  }

  const all = [];
  let offset = null;

  // Pull up to 100 at a time until done
  while (true) {
    const url =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}` +
      `?pageSize=100` +
      (offset ? `&offset=${encodeURIComponent(offset)}` : "");

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    });

    if (!r.ok) throw new Error("Airtable fetch failed");

    const data = await r.json();
    const records = Array.isArray(data.records) ? data.records : [];
    for (const rec of records) {
      all.push(rec.fields || {});
    }

    if (!data.offset) break;
    offset = data.offset;
  }

  return all;
}

// --- Season math (simple + robust) ---
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function safeAvg(nums) {
  const a = nums.filter(n => Number.isFinite(n));
  if (!a.length) return null;
  return a.reduce((s, n) => s + n, 0) / a.length;
}
function parseDateISO(d) {
  // expects YYYY-MM-DD
  if (!d || typeof d !== "string") return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
function sortByDate(games) {
  return [...games].sort((a, b) => (parseDateISO(a.Date) || 0) - (parseDateISO(b.Date) || 0));
}
function lastN(arr, n) {
  if (arr.length <= n) return arr;
  return arr.slice(arr.length - n);
}
function firstN(arr, n) {
  if (arr.length <= n) return arr;
  return arr.slice(0, n);
}

function buildSeasonSummary(sortedGames) {
  // We’ll base “improving/deteriorating” on recent vs early averages.
  // This is simple, stable, and explainable.
  const N = Math.min(5, Math.floor(sortedGames.length / 2) || 1);

  const early = firstN(sortedGames, N);
  const recent = lastN(sortedGames, N);

  const pick = (arr, key) => arr.map(g => toNum(g[key])).filter(v => v !== null);

  const earlyTeam = safeAvg(pick(early, "TeamScore"));
  const recentTeam = safeAvg(pick(recent, "TeamScore"));

  const earlyGoalie = safeAvg(pick(early, "GoalieScore"));
  const recentGoalie = safeAvg(pick(recent, "GoalieScore"));

  const earlyShare = safeAvg(pick(early, "ShotShare"));     // stored as decimal in your code
  const recentShare = safeAvg(pick(recent, "ShotShare"));

  const earlyGA = safeAvg(pick(early, "GA"));
  const recentGA = safeAvg(pick(recent, "GA"));

  const earlyGF = safeAvg(pick(early, "GF"));
  const recentGF = safeAvg(pick(recent, "GF"));

  const delta = (a, b) => (a === null || b === null) ? null : (b - a);

  return {
    gameCount: sortedGames.length,
    windowN: N,

    earlyAverages: {
      teamScore: earlyTeam,
      goalieScore: earlyGoalie,
      shotShare: earlyShare,
      goalsFor: earlyGF,
      goalsAgainst: earlyGA,
    },

    recentAverages: {
      teamScore: recentTeam,
      goalieScore: recentGoalie,
      shotShare: recentShare,
      goalsFor: recentGF,
      goalsAgainst: recentGA,
    },

    deltas: {
      teamScore: delta(earlyTeam, recentTeam),
      goalieScore: delta(earlyGoalie, recentGoalie),
      shotShare: delta(earlyShare, recentShare),
      goalsFor: delta(earlyGF, recentGF),
      goalsAgainst: delta(earlyGA, recentGA),
    },
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: "Missing OPENAI_API_KEY in Vercel env vars" });
    }

    // 1) pull all games from Airtable
    const allGames = await airtableFetchAllGames();

    // OPTIONAL FILTERS (keep it simple for now):
    // - If you want “season” only, you can later filter by Date >= season start.
    // - Or filter by Level (U11 only).
    // For now: use everything that has a Date.
    const games = allGames.filter(g => parseDateISO(g.Date));

    if (games.length < 3) {
      return res.status(200).json({
        success: true,
        text: `Not enough games saved yet (${games.length}). Save at least 3 games for a season trend.`
      });
    }

    const sorted = sortByDate(games);

    // 2) compute a short, explainable season summary (keeps the AI prompt small)
    const seasonSummary = buildSeasonSummary(sorted);

    // 3) ask GPT-5 to write the report
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-5",
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content:
            "You are a youth hockey coach writing a season review. " +
            "Be practical and specific. Use the numbers as truth. " +
            "Call out improvement vs deterioration clearly. " +
            "Output plain text with short headings and bullets."
        },
        {
          role: "user",
          content:
            "Write a season analysis using the Airtable game data.\n\n" +
            "SEASON SUMMARY (computed):\n" + JSON.stringify(seasonSummary) + "\n\n" +
            "ALL GAMES (Airtable fields only, sorted by date):\n" + JSON.stringify(sorted)
        }
      ]
    });

    return res.status(200).json({ success: true, text: response.output_text || "" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
};
