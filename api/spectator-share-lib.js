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
  const titleOpponent = truncateText(opponent, 24);

  return {
    code,
    opponent,
    opponentUpper: clampLabel(sanitizeForFont(opponentRaw).toUpperCase() || "OPPONENT", 22),
    goalsFor,
    goalsAgainst,
    period,
    updatedAt,
    version,
    title: `${titleOpponent} • ${goalsAgainst}-${goalsFor}`,
    description: `Live spectator view • ${period}`
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
    <div class="eyebrow">Live Spectator</div>
    <h1>${escapeHtml(model.opponent)} &bull; ${escapeHtml(model.goalsAgainst)}-${escapeHtml(model.goalsFor)}</h1>
    <p>${escapeHtml(model.period)} live spectator view</p>
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
  const aa = 3;
  const hiWidth = width * aa;
  const hiHeight = height * aa;
  const pixels = Buffer.alloc(hiWidth * hiHeight * 4);
  const s = (value) => Math.round(value * aa);

  fillVerticalGradient(pixels, hiWidth, hiHeight, [6, 11, 18, 255], [2, 5, 10, 255]);
  fillCircle(pixels, hiWidth, hiHeight, s(600), s(24), s(260), [17, 34, 58, 48]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(58), s(40), s(1084), s(548), s(28), [33, 52, 79, 255]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(60), s(42), s(1080), s(544), s(26), [10, 17, 27, 255]);

  fillCircle(pixels, hiWidth, hiHeight, s(108), s(106), s(8), [121, 215, 155, 255]);

  fillRoundedRect(pixels, hiWidth, hiHeight, s(92), s(166), s(1016), s(300), s(24), [34, 52, 78, 255]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(94), s(168), s(1012), s(296), s(22), [7, 12, 20, 255]);

  fillRoundedRect(pixels, hiWidth, hiHeight, s(118), s(194), s(300), s(244), s(18), [28, 29, 33, 255]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(448), s(224), s(304), s(92), s(16), [18, 28, 42, 255]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(782), s(194), s(300), s(244), s(18), [16, 25, 38, 255]);

  fillRoundedRect(pixels, hiWidth, hiHeight, s(132), s(194), s(272), s(4), s(2), [177, 154, 141, 255]);
  fillRoundedRect(pixels, hiWidth, hiHeight, s(796), s(194), s(272), s(4), s(2), [167, 187, 205, 255]);

  drawScoreGlyphTextCentered(pixels, hiWidth, hiHeight, "OPP", s(268), s(216), s(30), [193, 177, 168, 255], s(8));
  drawScoreGlyphTextCentered(pixels, hiWidth, hiHeight, "US", s(932), s(216), s(30), [184, 201, 220, 255], s(8));
  drawScoreGlyphTextCentered(pixels, hiWidth, hiHeight, String(model.goalsAgainst), s(268), s(274), s(88), [244, 246, 251, 255], s(18));
  drawScoreGlyphTextCentered(pixels, hiWidth, hiHeight, String(model.goalsFor), s(932), s(274), s(88), [244, 246, 251, 255], s(18));
  drawScoreGlyphTextCentered(pixels, hiWidth, hiHeight, model.period, s(600), s(246), s(40), [214, 223, 237, 255], s(10));

  return encodePng(width, height, downsampleRgba(pixels, hiWidth, hiHeight, aa));
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

function truncateText(value, maxChars) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function pickScale(text, maxWidth, preferred, min, spacing = 2) {
  for (let scale = preferred; scale >= min; scale -= 1) {
    if (measureText(text, scale, spacing) <= maxWidth) return scale;
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

function fillRoundedRect(pixels, width, height, x, y, rectWidth, rectHeight, radius, color) {
  const r = Math.max(0, Math.min(radius, rectWidth / 2, rectHeight / 2));
  if (r <= 0) {
    fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color);
    return;
  }
  fillRect(pixels, width, height, x + r, y, rectWidth - (2 * r), rectHeight, color);
  fillRect(pixels, width, height, x, y + r, rectWidth, rectHeight - (2 * r), color);
  fillCircle(pixels, width, height, x + r, y + r, r, color);
  fillCircle(pixels, width, height, x + rectWidth - r, y + r, r, color);
  fillCircle(pixels, width, height, x + r, y + rectHeight - r, r, color);
  fillCircle(pixels, width, height, x + rectWidth - r, y + rectHeight - r, r, color);
}

function fillCircle(pixels, width, height, centerX, centerY, radius, color) {
  const rSquared = radius * radius;
  const startX = Math.max(0, Math.floor(centerX - radius));
  const endX = Math.min(width, Math.ceil(centerX + radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endY = Math.min(height, Math.ceil(centerY + radius));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const dx = px - centerX;
      const dy = py - centerY;
      if ((dx * dx) + (dy * dy) > rSquared) continue;
      const idx = (py * width + px) * 4;
      blendPixel(pixels, idx, color);
    }
  }
}

function drawScoreGlyphTextCentered(pixels, width, height, text, centerX, y, size, color, gap) {
  const glyphHeight = Math.round(size * 1.16);
  const totalWidth = measureScoreGlyphText(text, size, gap);
  const x = Math.round(centerX - (totalWidth / 2));
  drawScoreGlyphText(pixels, width, height, text, x, y, size, color, gap, glyphHeight);
}

function drawScoreGlyphText(pixels, width, height, text, x, y, size, color, gap, glyphHeight = Math.round(size * 1.16)) {
  let cursor = x;
  for (const rawChar of String(text || "").toUpperCase()) {
    const glyph = SCORE_GLYPHS[rawChar];
    if (!glyph) {
      cursor += Math.round(size * 0.56) + gap;
      continue;
    }
    drawScoreGlyph(pixels, width, height, glyph, cursor, y, size, glyphHeight, color);
    cursor += glyphAdvance(glyph, size) + gap;
  }
}

function drawScoreGlyph(pixels, width, height, glyph, x, y, size, glyphHeight, color) {
  const thickness = Math.max(4, Math.round(size * 0.18));
  const verticalHeight = Math.max(thickness, Math.round((glyphHeight - (3 * thickness)) / 2));
  const left = x;
  const top = y;
  const rightX = left + size - thickness;
  const upperY = top + thickness;
  const middleY = top + thickness + verticalHeight;
  const lowerY = middleY + thickness;
  const bottomY = top + glyphHeight - thickness;
  const centerX = left + Math.round((size - thickness) / 2);
  const radius = Math.max(2, Math.round(thickness / 2));

  const segments = {
    a: [left + thickness, top, size - (2 * thickness), thickness],
    d: [left + thickness, bottomY, size - (2 * thickness), thickness],
    g: [left + thickness, middleY, size - (2 * thickness), thickness],
    f: [left, upperY, thickness, verticalHeight],
    b: [rightX, upperY, thickness, verticalHeight],
    e: [left, lowerY, thickness, verticalHeight],
    c: [rightX, lowerY, thickness, verticalHeight],
    i: [centerX, upperY, thickness, glyphHeight - (2 * thickness)],
  };

  for (const key of glyph) {
    const segment = segments[key];
    if (!segment) continue;
    fillRoundedRect(pixels, width, height, segment[0], segment[1], segment[2], segment[3], radius, color);
  }
}

function measureScoreGlyphText(text, size, gap) {
  let total = 0;
  const chars = String(text || "").toUpperCase().split("");
  chars.forEach((char, index) => {
    total += glyphAdvance(SCORE_GLYPHS[char], size);
    if (index < chars.length - 1) total += gap;
  });
  return total;
}

function glyphAdvance(glyph, size) {
  if (!glyph) return Math.round(size * 0.56);
  return glyph.includes("narrow") ? Math.round(size * 0.72) : size;
}

function downsampleRgba(source, srcWidth, srcHeight, factor) {
  const width = Math.floor(srcWidth / factor);
  const height = Math.floor(srcHeight / factor);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let oy = 0; oy < factor; oy += 1) {
        for (let ox = 0; ox < factor; ox += 1) {
          const srcIndex = (((y * factor) + oy) * srcWidth + ((x * factor) + ox)) * 4;
          r += source[srcIndex];
          g += source[srcIndex + 1];
          b += source[srcIndex + 2];
          a += source[srcIndex + 3];
        }
      }
      const samples = factor * factor;
      const dstIndex = (y * width + x) * 4;
      out[dstIndex] = Math.round(r / samples);
      out[dstIndex + 1] = Math.round(g / samples);
      out[dstIndex + 2] = Math.round(b / samples);
      out[dstIndex + 3] = Math.round(a / samples);
    }
  }
  return out;
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

function blendPixel(pixels, idx, color) {
  const alpha = (color[3] ?? 255) / 255;
  if (alpha >= 1) {
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = 255;
    return;
  }

  const inv = 1 - alpha;
  pixels[idx] = Math.round((color[0] * alpha) + (pixels[idx] * inv));
  pixels[idx + 1] = Math.round((color[1] * alpha) + (pixels[idx + 1] * inv));
  pixels[idx + 2] = Math.round((color[2] * alpha) + (pixels[idx + 2] * inv));
  pixels[idx + 3] = 255;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const SCORE_GLYPHS = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c", "narrow"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
  "O": ["a", "b", "c", "d", "e", "f"],
  "P": ["a", "b", "e", "f", "g"],
  "U": ["b", "c", "d", "e", "f"],
  "S": ["a", "f", "g", "c", "d"],
  "T": ["a", "i"],
};
