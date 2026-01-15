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

function basicGoalieLine(game) {
  const sa = safeNum(game.SA ?? game.sa ?? game.shotsAgainst ?? game.themShots);
  const ga = safeNum(game.GA ?? game.ga ?? game.goalsAgainst ?? game.themGoals);
  const saves = (sa !== null && ga !== null) ? Math.max(0, sa - ga) : null;
  const svPct = (sa && saves !== null) ? (saves / sa) : null;

  return { sa, ga, saves, svPct };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }

    const body = await readJson(req);
    const game = body.game || null;

    if (!game) {
      res.status(400).json({ success: false, error: "Send { game: {...} }" });
      return;
    }

    const line = basicGoalieLine(game);

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5.2";

    const system = [
      "You write a concise goalie performance report.",
      "Use the provided stats only; do not invent details.",
      "Structure: (1) stat line, (2) what went well, (3) what hurt, (4) 3 focus points for next week."
    ].join(" ");

    const user = {
      instruction: "Generate the Goalie Report.",
      game,
      computed: line
    };

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
