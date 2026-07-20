// Shared helpers for the spectator share surfaces:
// - buildShareModel(): normalizes a live_games snapshot for og/html/preview
// - renderShareHtml(): the dynamic share page (og:image -> /api/spectator-preview)
// - renderPreviewPng(): the Ice-themed 1200x630 og-image (P3.4a)
//
// renderPreviewPng() is zero-dependency pixel-buffer compositing: it alpha-
// composites sprites baked by outputs/brand/share-template/bake_share_assets.py
// (template, status pills, Saira/Hanken glyph sheets) and encodes the result
// with its own PNG encoder. The bundled minimal PNG decoder only supports what
// the bake script emits: 8-bit RGBA, non-interlaced.
//
// Sprites arrive via ./_share-assets-embedded.js (base64 in the module graph),
// NOT readFileSync — a deployed function cannot depend on file tracing. See
// outputs/brand/share-template/embed_share_assets.mjs. api/_share-assets/ stays
// on disk as the source of truth for that generator and for dev_server.py.

import { deflateSync, inflateSync } from "node:zlib";
import { manifest as SHARE_MANIFEST, files as SHARE_FILES } from "./_share-assets-embedded.js";

// Ice palette tints (design/spectator-ice.html); applied to white sprite art.
const TINT_SCORE_THEM = [255, 128, 136]; // .score.them
const TINT_SCORE_US = [122, 172, 255];   // .score.us
const TINT_LABEL = [194, 206, 221];      // --muted
const TINT_PERIOD = [219, 227, 240];     // .period text
const TINT_CREST_THEM = [205, 214, 226]; // .crest.them text
const TINT_CREST_US = [220, 233, 255];   // .crest.us text

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
  const teamRaw = typeof state.teamName === "string" ? state.teamName.trim() : "";
  const opponent = titleCase(opponentRaw);
  const goalsFor = safeNum(state.goalsFor);
  const goalsAgainst = safeNum(state.goalsAgainst);
  const period = periodLabel(state.period);
  const ended = !!(state.ended || state.final);
  const status = snapshot ? (ended ? "final" : "live") : "waiting";
  const updatedAt = snapshot && snapshot.updated_at ? snapshot.updated_at : null;
  const version = updatedAt ? Date.parse(updatedAt) || Date.now() : Date.now();
  const titleOpponent = truncateText(opponent, 24);

  return {
    code,
    opponent,
    goalsFor,
    goalsAgainst,
    period,
    status,
    periodText: status === "waiting" ? "VS" : period,
    opponentLabel: clampLabel(sanitizeForFont(opponentRaw).toUpperCase() || "OPPONENT", 18),
    teamLabel: clampLabel(sanitizeForFont(teamRaw).toUpperCase() || "US", 18),
    opponentInitials: crestInitials(opponentRaw, "OP"),
    teamInitials: crestInitials(teamRaw, "US"),
    updatedAt,
    version,
    title: `${titleOpponent} • ${goalsAgainst}-${goalsFor}`,
    description: status === "final"
      ? `Final score • ${period}`
      : status === "waiting"
        ? "Live spectator view"
        : `Live spectator view • ${period}`
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

// Un-composited template, for when sprite compositing fails. Still a branded
// 1200x630 card, so a share link never degrades to a broken image.
export function renderFallbackPng() {
  return Buffer.from(SHARE_FILES[SHARE_MANIFEST.template.file], "base64");
}

export function renderPreviewPng(model) {
  const assets = loadShareAssets();
  const layout = assets.manifest.layout;
  const width = assets.manifest.template.w;
  const height = assets.manifest.template.h;
  const out = Buffer.from(assets.template.data);

  const pillKey = model.status === "live" ? "live" : model.status === "final" ? "final" : "soon";
  const pill = assets.pills[pillKey];
  blitSprite(out, width, height, pill.image, layout.pill.x - pill.margin, layout.pill.y - pill.margin);

  const crestCy = layout.crest.top + (layout.crest.h / 2);
  drawSheetText(out, width, height, assets.sheets.lg, model.opponentInitials, layout.them.cx, crestCy, TINT_CREST_THEM, 2);
  drawSheetText(out, width, height, assets.sheets.lg, model.teamInitials, layout.us.cx, crestCy, TINT_CREST_US, 2);
  drawSheetText(out, width, height, assets.sheets.sm, model.opponentLabel, layout.them.cx, layout.labelCapCy, TINT_LABEL, 3);
  drawSheetText(out, width, height, assets.sheets.sm, model.teamLabel, layout.us.cx, layout.labelCapCy, TINT_LABEL, 3);
  drawSheetText(out, width, height, assets.sheets.score, String(model.goalsAgainst), layout.them.cx, layout.scoreCapCy, TINT_SCORE_THEM, 4);
  drawSheetText(out, width, height, assets.sheets.score, String(model.goalsFor), layout.us.cx, layout.scoreCapCy, TINT_SCORE_US, 4);
  drawSheetText(out, width, height, assets.sheets.lg, model.periodText, layout.period.cx, layout.period.cy, TINT_PERIOD, 2);

  return encodePng(width, height, out);
}

// ---------------------------------------------------------------------------
// Baked-sprite loading + compositing

let assetCache = null;

function loadShareAssets() {
  if (assetCache) return assetCache;
  const manifest = SHARE_MANIFEST;
  const load = (file) => {
    const b64 = SHARE_FILES[file];
    if (!b64) throw new Error(`share sprite missing from embedded bundle: ${file}`);
    return decodePng(Buffer.from(b64, "base64"));
  };
  const pills = {};
  for (const [key, meta] of Object.entries(manifest.pills)) {
    pills[key] = { ...meta, image: load(meta.file) };
  }
  const sheets = {};
  for (const [key, meta] of Object.entries(manifest.sheets)) {
    sheets[key] = { ...meta, image: load(meta.file) };
  }
  assetCache = { manifest, template: load(manifest.template.file), pills, sheets };
  return assetCache;
}

// Minimal PNG decoder for the baked assets only: 8-bit RGBA, non-interlaced,
// standard filters 0-4. Anything else throws.
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (buffer[i] !== signature[i]) throw new Error("share-assets: not a PNG");
  }

  let width = 0;
  let height = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const interlace = buffer[dataStart + 12];
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error("share-assets: unsupported PNG format (need 8-bit RGBA, non-interlaced)");
      }
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    const prevStart = outStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + x];
      const left = x >= 4 ? data[outStart + x - 4] : 0;
      const up = y > 0 ? data[prevStart + x] : 0;
      const upLeft = (y > 0 && x >= 4) ? data[prevStart + x - 4] : 0;
      let reconstructed;
      if (filter === 0) reconstructed = value;
      else if (filter === 1) reconstructed = value + left;
      else if (filter === 2) reconstructed = value + up;
      else if (filter === 3) reconstructed = value + ((left + up) >> 1);
      else if (filter === 4) reconstructed = value + paeth(left, up, upLeft);
      else throw new Error(`share-assets: unsupported PNG filter ${filter}`);
      data[outStart + x] = reconstructed & 0xff;
    }
  }
  return { width, height, data };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Source-over blit of an RGBA sprite region onto the opaque canvas.
// tint multiplies the sprite's RGB channels (used to color white glyph art).
function blitSprite(dst, dstWidth, dstHeight, sprite, dx, dy, srcX = 0, srcW = sprite.width, tint = null) {
  const [tr, tg, tb] = tint || [255, 255, 255];
  for (let y = 0; y < sprite.height; y += 1) {
    const py = dy + y;
    if (py < 0 || py >= dstHeight) continue;
    for (let x = 0; x < srcW; x += 1) {
      const px = dx + x;
      if (px < 0 || px >= dstWidth) continue;
      const s = (y * sprite.width + (srcX + x)) * 4;
      const alpha = sprite.data[s + 3];
      if (!alpha) continue;
      const d = (py * dstWidth + px) * 4;
      const a = alpha / 255;
      const inv = 1 - a;
      const sr = (sprite.data[s] * tr) / 255;
      const sg = (sprite.data[s + 1] * tg) / 255;
      const sb = (sprite.data[s + 2] * tb) / 255;
      dst[d] = Math.round((sr * a) + (dst[d] * inv));
      dst[d + 1] = Math.round((sg * a) + (dst[d + 1] * inv));
      dst[d + 2] = Math.round((sb * a) + (dst[d + 2] * inv));
      dst[d + 3] = 255;
    }
  }
}

// Draw text from a baked glyph sheet, horizontally centered on centerX with the
// capital height centered on capCy. Unknown glyphs (incl. spaces) advance only.
function drawSheetText(dst, dstWidth, dstHeight, sheet, text, centerX, capCy, tint, tracking = 0) {
  const chars = [...String(text || "").toUpperCase()];
  if (!chars.length) return;
  const capHeight = sheet.capBottom - sheet.capTop;
  const fallbackAdv = capHeight * 0.55;
  let total = 0;
  chars.forEach((ch, index) => {
    const glyph = sheet.chars[ch];
    total += glyph ? glyph.adv : fallbackAdv;
    if (index < chars.length - 1) total += tracking;
  });

  let pen = centerX - (total / 2);
  const top = Math.round(capCy - ((sheet.capTop + sheet.capBottom) / 2));
  for (const ch of chars) {
    const glyph = sheet.chars[ch];
    if (!glyph) {
      pen += fallbackAdv + tracking;
      continue;
    }
    blitSprite(dst, dstWidth, dstHeight, sheet.image, Math.round(pen + glyph.dx), top, glyph.x, glyph.w, tint);
    pen += glyph.adv + tracking;
  }
}

// ---------------------------------------------------------------------------
// Model helpers

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

function crestInitials(name, fallback) {
  const words = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0]}${words[1][0]}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// PNG encoding (filtered scanlines keep the photographic template small)

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    let bestFilter = 0;
    let bestScore = Infinity;

    for (const filter of [0, 1, 2, 3, 4]) {
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const value = rgba[rowStart + x];
        const left = x >= 4 ? rgba[rowStart + x - 4] : 0;
        const up = y > 0 ? rgba[prevStart + x] : 0;
        const upLeft = (y > 0 && x >= 4) ? rgba[prevStart + x - 4] : 0;
        let filtered;
        if (filter === 0) filtered = value;
        else if (filter === 1) filtered = value - left;
        else if (filter === 2) filtered = value - up;
        else if (filter === 3) filtered = value - ((left + up) >> 1);
        else filtered = value - paeth(left, up, upLeft);
        filtered &= 0xff;
        candidate[x] = filtered;
        score += filtered < 128 ? filtered : 256 - filtered;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        candidate.copy(best);
      }
    }

    const outStart = y * (stride + 1);
    raw[outStart] = bestFilter;
    best.copy(raw, outStart + 1);
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

  const compressed = deflateSync(raw, { level: 9 });
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
