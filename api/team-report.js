async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => {
    req.on("data", (c) => (raw += c));
    req.on("end", resolve);
  });
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function summarizeGame(game) {
  // Try multiple common field names so you don’t have to be perfect.
  const gf = safeNum(game.GF ?? game.gf ?? game.goalsFor ?? game.usGoals);
  const ga = safeNum(game.GA ?? game.ga ?? game.goalsAgainst ?? game.themGoals);
  const sf = safeNum(game.SF ?? game.sf ?? game.shotsFor ?? game.usShots);
  const sa = safeNum(game.SA ?? game.sa ?? game.shotsAgainst ?? game.themShots);
  const opp = (game.Opponent ?? game.opponent ?? "").toString();
  const lvl = (game.Level ?? game.level ?? "").toString();
  const date = (game.Date ?? game.date ?? "").toString();

  return { date, opp, lvl, gf, ga, sf, sa, raw: game };
}

async function fetchAirtableGames({ season, limit }) {
  const key = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_GAMES_TABLE || "Games";
  if (!key || !base) return [];

  // You can change this to whatever “season” means for you.
  // E.g., store a Season field in Airtable and filterByFormula on it.
  const filterByFormula = season
    ? `&filterByFormula=${encodeURIComponent(`{Season}='${season}'`)}`
    : "";

  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const url =
    `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}` +
    `?pageSize=${pageSize}${filterByFormula}`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` }
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable fetch failed: ${r.status} ${txt}`);
  }

  const data = await r.json();
  const records = Array.isArray(data.records) ? data.records : [];
  return records.map((rec) => rec.fields || {});
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }

    const body = await readJson(req);

    // Inputs supported:
    // - { game: {...} } for a single-game report
    // - { games: [{...},{...}] } if you already have multiple
    // - { season: "2025-26", limit: 20 } if you want the API to pull from Airtable
    let games = [];

    if (body.game) games = [body.game];
    else if (Array.isArray(body.games)) games = body.games;
    else if (body.season || body.limit) games = await fetchAirtableGames({ season: body.season, limit: body.limit });

    if (!games.length) {
      res.status(400).json({
        success: false,
        error: "No game data provided. Send {game} or {games}, or configure Airtable + send {season}."
      });
      return;
    }

    const sGames = games.map(summarizeGame);

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const system = [
      "You write a concise hockey TEAM report for coaches and parents.",
      "Be specific and numbers-driven. No fluff. No invented facts.",
      "If a stat is missing, say it’s missing and move on.",
      "Structure: (1) result snapshot, (2) shot/possession, (3) chances, (4) what to work on next practice (3 bullets)."
    ].join(" ");

    const user = {
      instruction: "Generate the Team Report.",
      games: sGames
    };

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    });

    const text =
      (resp.output_text && resp.output_text.trim()) ||
      "";

    res.status(200).json({ success: true, text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Server error" });
  }
};
