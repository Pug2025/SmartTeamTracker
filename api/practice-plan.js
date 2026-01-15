const OpenAI = require("openai");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: "Missing OPENAI_API_KEY in Vercel env vars" });
    }

    const body = req.body || {};
    const game = body.game;
    const derived = body.derived || {};

    if (!game) {
      return res.status(400).json({ success: false, error: "Missing body.game" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Use GPT-5.2. If you later want cheaper/faster, change to "gpt-5-mini".
    const model = "gpt-5.2";

    const response = await client.responses.create({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content:
            "You are a youth hockey coach. Be practical and specific. " +
            "Use the provided stats as truth. Output plain text with short headings and bullets."
        },
        {
          role: "user",
          content:
            "Create a 45-minute practice plan that targets the biggest issues shown in this game.\n\n" +
            "FULL COLLECTED GAME OBJECT:\n" + JSON.stringify(game) + "\n\n" +
            "DERIVED BREAKDOWNS (computed by the app):\n" + JSON.stringify(derived)
        }
      ]
    });

    return res.status(200).json({ success: true, text: response.output_text || "" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Server error" });
  }
};
