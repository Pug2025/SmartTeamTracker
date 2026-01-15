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

function normalizeGame(g) {
  return {
    date: (g.Date ?? g.date ?? "").toString(),
    opp: (g.Opponent ?? g.opponent ?? "").toString(),
    level: (g.Level ?? g.level ?? "").toString(),
    gf: safeNum(g.GF ?? g.gf ?? g.goalsFor ?? g.usGoals),
    ga: safeNum(g.GA ?? g.ga ?? g.goalsAgainst ?? g.themGoals),
    sf: safeNum(g.SF ?? g.sf ?? g.shotsFor ?? g.usShots),
    sa: safeNum(g.SA ?? g.sa ?? g.shotsAgainst ?? g.themShots),
    teamScore: safeNum(g.TeamScore ?? g.teamScore),
    goalieScore: safeNum(g.GoalieScore ?? g.goalieScore)
  };
}

async function fetchAirtableGames({ season }) {
  const key = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_GAMES_TABLE || "Games";
  if (!key || !base) return [];

  const filterByFormula = season
    ? `&filterByFormula=${encodeURIComponent(`{Season}='${season}'`)}`
    : "";

  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?pageSize=50${filterByFormula}`;

  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable fetch failed: ${r.status} ${txt}`);
  }
  const data = await r.json();
  const records = Array.isArray(data.records) ? data.records : [];
  return records.map((rec) => rec.fields || {});
}

function seasonTotals(games) {
  let gf = 0, ga = 0, sf = 0, sa = 0, n = 0, w = 0, l = 0, t = 0;

  for (const g of games) {
    const Gf = safeNum(g.gf), Ga = safeNum(g.ga);
    const Sf = safeNum(g.sf), Sa = safeNum(g.sa);

    if (Gf !== null && Ga !== null) {
      gf += Gf; ga += Ga; n++;
      if (Gf > Ga) w++;
      else if (Gf < Ga) l++;
      else t++;
    }
    if (Sf !== null) sf += Sf;
    if (Sa !== null) sa += Sa;
  }

  return { gamesCount: games.length, decidedCount: n, w, l, t, gf, ga, sf, sa };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }

    const body = await readJson(req);

    // Inputs supported:
    // - { games: [...] } (best)
    // - { season: "2025-26" } with Airtable configured
    let rawGames = Array.isArray(body.games) ? body.games : [];
    if (!rawGames.length && body.season) {
      rawGames = await fetchAirtableGames({ season: body.season });
    }

    if (!rawGames.length) {
      res.status(400).json({
        success: false,
        error: "No games provided. Send {games:[...]} or configure Airtable and send {season}."
      });
      return;
    }

    const games = rawGames.map(normalizeGame);
    const totals = seasonTotals(games);

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const system = [
      "You write a concise SEASON report for a youth hockey team.",
      "Use only provided data; do not invent game details.",
      "Structure: (1) record + totals, (2) what the numbers say about style, (3) 3 biggest recurring issues, (4) 3 priorities for the next 4 practices."
    ].join(" ");

    const user = { instruction: "Generate the Season Report.", totals, games };

    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    });

    const text = (resp.output_text && resp.output_text.trim()) || "";
    res.status(200).json({ success: true, text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message || "Server error" });
  }
};
