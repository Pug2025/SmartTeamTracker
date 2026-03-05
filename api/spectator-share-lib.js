import { deflateSync } from "node:zlib";

const FONT = {
  "A": ["01110","10001","10001","11111","10001","10001","10001"],
  "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01111","10000","10000","10000","10000","10000","01111"],
  "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"],
  "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01111","10000","10000","10111","10001","10001","01111"],
  "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["11111","00100","00100","00100","00100","00100","11111"],
  "J": ["00111","00010","00010","00010","00010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"],
  "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"],
  "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"],
  "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"],
  "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"],
  "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"],
  "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"],
  "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"],
  "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00001","01110"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"],
  ".": ["00000","00000","00000","00000","00000","01100","01100"],
  "'": ["00100","00100","00000","00000","00000","00000","00000"],
  "&": ["01100","10010","10100","01000","10101","10010","01101"],
  "/": ["00001","00010","00100","01000","10000","00000","00000"],
  ":": ["00000","01100","01100","00000","01100","01100","00000"],
  "|": ["00100","00100","00100","00100","00100","00100","00100"]
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let i = 0; i < 8; i += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return c >>> 0;
});

export async function fetchLiveSnapshot(code) {
  if (!code) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/live_games?share_code=eq.${encodeURIComponent(code)}&select=share_code,game_id,state,updated_at&order=updated_at.desc&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

export function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
}

export function buildShareModel(snapshot, code) {
  const state = snapshot && snapshot.state && typeof snapshot.state === "object" ? snapshot.state : {};
  const opponentRaw = typeof state.opponent === "string" && state.opponent.trim() ? state.opponent.trim() : "Opponent";
  const opponent = titleCase(opponentRaw);
  const goalsFor = safeNum(state.goalsFor);
  const goalsAgainst = safeNum(state.goalsAgainst);
  const period = periodLabel(state.period);
  const updatedAt = snapshot && snapshot.updated_at ? snapshot.updated_at : null;
  const version = updatedAt ? Date.parse(updatedAt) || Date.now() : Date.now();

  return {
    code,
    opponent,
    opponentUpper: clampLabel(sanitizeForFont(opponentRaw).toUpperCase() || "OPPONENT", 22),
    goalsFor,
    goalsAgainst,
    period,
    updatedAt,
    version,
    title: `Live Spectator View: ${opponent} vs Us`,
    description: `${period} • ${opponent} ${goalsAgainst}, Us ${goalsFor} • Open the live spectator view.`
  };
}

export function renderShareHtml({ model, baseUrl }) {
  const liveParam = encodeURIComponent(model.code || "");
  const imageUrl = `${baseUrl}/api/spectator-preview?live=${liveParam}&v=${encodeURIComponent(String(model.version))}`;
  const openUrl = `${baseUrl}/?live=${liveParam}`;
  const title = escapeHtml(model.title);
  const description = escapeHtml(model.description);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>${title}</title>
<meta name="theme-color" content="#07111b" />
<meta name="description" content="${description}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SmartTeamTracker" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${escapeHtml(`${baseUrl}/api/spectator-share?live=${liveParam}`)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(`${model.opponent} live spectator preview`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at 50% -10%, rgba(145,188,236,0.18), transparent 28%),linear-gradient(180deg,#08111b 0%,#04090f 100%);color:#f4f6fb;font-family:"Avenir Next","SF Pro Display",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .card{width:min(100%,520px);background:rgba(12,19,30,0.96);border:1px solid #27415d;border-radius:24px;padding:28px 24px 24px;box-shadow:0 24px 60px rgba(0,0,0,0.36),inset 0 1px 0 rgba(255,255,255,0.03);text-align:center}
  .eyebrow{color:#8fe3ad;font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase}
  h1{margin:14px 0 10px;font-size:32px;line-height:1.08;letter-spacing:-0.7px}
  p{margin:0;color:#aab8cc;font-size:15px;line-height:1.5}
  .preview{margin:22px auto 0;width:100%;border-radius:18px;border:1px solid rgba(135,155,187,0.16);overflow:hidden;background:#0a121d}
  .preview img{display:block;width:100%;height:auto}
  .fallback{margin-top:18px;font-size:14px}
  .fallback a{color:#d8e6f6}
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Live Spectator View</div>
    <h1>${escapeHtml(model.opponent)} ${model.goalsAgainst}-${model.goalsFor} Us</h1>
    <p>${escapeHtml(model.period)} • Opening the live spectator screen for this game.</p>
    <div class="preview"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(`${model.opponent} spectator preview`)}" /></div>
    <div class="fallback"><a href="${escapeHtml(openUrl)}">Open spectator view</a></div>
  </main>
  <script>window.location.replace(${JSON.stringify(openUrl)});</script>
</body>
</html>`;
}

export function renderPreviewPng(model) {
  const width = 1200;
  const height = 630;
  const pixels = Buffer.alloc(width * height * 4);

  fillVerticalGradient(pixels, width, height, [8, 17, 27, 255], [4, 9, 15, 255]);
  fillRect(pixels, width, height, 42, 38, 1116, 554, [15, 24, 37, 255]);
  strokeRect(pixels, width, height, 42, 38, 1116, 554, [39, 59, 88, 255], 2);
  fillRect(pixels, width, height, 92, 330, 300, 6, [121, 215, 155, 255]);

  drawText(pixels, width, height, "LIVE SPECTATOR VIEW", 92, 110, 4, [143, 227, 173, 255], 2);
  const opponentScale = pickScale(model.opponentUpper, 980, 11, 6);
  drawText(pixels, width, height, model.opponentUpper, 92, 180, opponentScale, [245, 247, 251, 255], 2);
  drawText(pixels, width, height, `${model.period} | LIVE SCORE`, 92, 252, 4, [176, 189, 209, 255], 2);

  fillRect(pixels, width, height, 92, 356, 1016, 144, [10, 18, 29, 255]);
  strokeRect(pixels, width, height, 92, 356, 1016, 144, [42, 65, 94, 255], 2);

  fillRect(pixels, width, height, 118, 383, 286, 90, [22, 26, 33, 255]);
  strokeRect(pixels, width, height, 118, 383, 286, 90, [58, 61, 67, 255], 2);
  fillRect(pixels, width, height, 447, 383, 306, 90, [18, 26, 38, 255]);
  strokeRect(pixels, width, height, 447, 383, 306, 90, [48, 69, 95, 255], 2);
  fillRect(pixels, width, height, 796, 383, 286, 90, [16, 26, 39, 255]);
  strokeRect(pixels, width, height, 796, 383, 286, 90, [48, 69, 95, 255], 2);

  drawCenteredText(pixels, width, height, "THEM", 261, 406, 3, [189, 169, 158, 255], 1);
  drawCenteredText(pixels, width, height, String(model.goalsAgainst), 261, 427, 9, [244, 246, 251, 255], 2);

  drawCenteredText(pixels, width, height, model.period, 600, 428, 5, [214, 223, 237, 255], 2);

  drawCenteredText(pixels, width, height, "US", 939, 406, 3, [185, 200, 216, 255], 1);
  drawCenteredText(pixels, width, height, String(model.goalsFor), 939, 427, 9, [244, 246, 251, 255], 2);

  drawText(pixels, width, height, "SMARTTEAMTRACKER", 92, 548, 4, [127, 148, 180, 255], 2);

  return encodePng(width, height, pixels);
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function periodLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "LIVE";
  if (n <= 3) return `P${Math.max(1, Math.round(n))}`;
  if (Math.round(n) === 4) return "OT";
  return `P${Math.round(n)}`;
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function sanitizeForFont(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .:&'\/|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLabel(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function pickScale(text, maxWidth, preferred, min) {
  for (let scale = preferred; scale >= min; scale -= 1) {
    if (measureText(text, scale, 2) <= maxWidth) return scale;
  }
  return min;
}

function measureText(text, scale, spacing) {
  if (!text) return 0;
  return text.length * ((5 * scale) + spacing) - spacing;
}

function drawCenteredText(pixels, width, height, text, centerX, y, scale, color, spacing) {
  const x = Math.round(centerX - (measureText(text, scale, spacing) / 2));
  drawText(pixels, width, height, text, x, y, scale, color, spacing);
}

function drawText(pixels, width, height, text, x, y, scale, color, spacing = 1) {
  let cursor = x;
  for (const rawChar of String(text || "").toUpperCase()) {
    const glyph = FONT[rawChar] || FONT[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        fillRect(pixels, width, height, cursor + (col * scale), y + (row * scale), scale, scale, color);
      }
    }
    cursor += (5 * scale) + spacing;
  }
}

function fillVerticalGradient(pixels, width, height, topColor, bottomColor) {
  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(1, height - 1);
    fillRect(pixels, width, height, 0, y, width, 1, [
      lerp(topColor[0], bottomColor[0], t),
      lerp(topColor[1], bottomColor[1], t),
      lerp(topColor[2], bottomColor[2], t),
      255
    ]);
  }
}

function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const idx = (py * width + px) * 4;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }
}

function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color, thickness = 1) {
  fillRect(pixels, width, height, x, y, rectWidth, thickness, color);
  fillRect(pixels, width, height, x, y + rectHeight - thickness, rectWidth, thickness, color);
  fillRect(pixels, width, height, x, y, thickness, rectHeight, color);
  fillRect(pixels, width, height, x + rectWidth - thickness, y, thickness, rectHeight, color);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([size, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function lerp(a, b, t) {
  return Math.round(a + ((b - a) * t));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
