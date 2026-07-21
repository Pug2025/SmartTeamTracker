/* ==========================================================================
 * share-card.js — post-game recap card (Phase 6.1)
 *
 * Renders a 1080x1920 branded recap image on-device with the Canvas 2D API and
 * hands it to the native share sheet. On-device (not the server) so it works
 * offline at the rink, is instant, and can never 500. Free forever — this card
 * is the growth loop: every one a parent posts is a no-cost ad.
 *
 * Design locked from design/card-mockup.html (light "Ice" theme):
 * lockup -> FINAL -> result -> score -> matchup -> meta -> 3 stats -> footer.
 * The third stat is "Team Rating NN/100": a proprietary hook, made legible by
 * the /100 scale, with the full derivation one tap into the app.
 *
 * Public API (attached to window):
 *   STTShareCard.render(data)  -> Promise<Blob>   JPEG blob, for tests/preview
 *   STTShareCard.share(data)   -> Promise<{ok, method}>  share sheet or download
 * ======================================================================== */
(function () {
  "use strict";

  var W = 1080, H = 1920, CX = W / 2;

  // Ice palette (design/spectator-ice.html + locked tokens)
  var INK = "#0E1826", INK_MUTE = "#5A6B7E", DASH = "#9FB0BF";
  var TEAL = "#0D8FA0", WIN = "#1FB880", LOSS = "#DB3B4B", TIE = "#F4A627";
  var US = "#2F6FED", THEM = "#DB3B4B";
  var DISPLAY = '"Saira Semi Condensed"', UI = '"Hanken Grotesk"';

  var ASSETS = {
    texture: "/assets/brand/ice-texture-light-1920.webp",
    lockup: "/assets/brand/lockup-dark-640.webp"
  };

  var _imgCache = {};
  function loadImage(src) {
    if (_imgCache[src]) return _imgCache[src];
    _imgCache[src] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image load failed: " + src)); };
      img.src = src;
    });
    return _imgCache[src];
  }

  // Canvas can only paint a webfont once the browser has actually loaded that
  // family+weight; otherwise it silently falls back to a system face. The app
  // loads Saira/Hanken on every screen, but force-await them to be safe.
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('900 100px ' + DISPLAY),
      document.fonts.load('800 100px ' + DISPLAY),
      document.fonts.load('700 100px ' + DISPLAY),
      document.fonts.load('800 40px ' + UI),
      document.fonts.load('600 40px ' + UI)
    ]).catch(function () { /* fall back to whatever is available */ });
  }

  function resultColor(r) { return r === "WIN" ? WIN : r === "LOSS" ? LOSS : TIE; }

  // "cover"-fit an image into a rect (like background-size:cover)
  function drawCover(ctx, img, x, y, w, h) {
    var ir = img.width / img.height, rr = w / h, sw, sh, sx, sy;
    if (ir > rr) { sh = img.height; sw = sh * rr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / rr; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  // Draw a centered stat cell: big value (with optional small suffix) + label.
  function drawStat(ctx, cx, value, suffix, label, valueColor) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = valueColor;
    ctx.font = '800 66px ' + DISPLAY;
    var vw = ctx.measureText(value).width;
    var sw = 0;
    if (suffix) { ctx.font = '700 34px ' + DISPLAY; sw = ctx.measureText(suffix).width + 3; }
    // center the value+suffix group
    var startX = cx - (vw + sw) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = valueColor;
    ctx.font = '800 66px ' + DISPLAY;
    ctx.fillText(value, startX, 0); // y set by caller via translate
    if (suffix) {
      ctx.fillStyle = INK_MUTE;
      ctx.font = '700 34px ' + DISPLAY;
      ctx.fillText(suffix, startX + vw + 3, 0);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = INK_MUTE;
    ctx.font = '700 21px ' + UI;
    ctx.fillText(label.toUpperCase(), cx, 46);
  }

  function drawCrest(ctx, cx, cy, initials, color) {
    var s = 116;
    roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 32);
    ctx.fillStyle = "rgba(14,24,38,0.05)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(14,24,38,0.16)";
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '800 44px ' + DISPLAY;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, cx, cy + 3);
    ctx.textBaseline = "alphabetic";
  }

  async function render(data) {
    await ensureFonts();
    var tex = await loadImage(ASSETS.texture);
    var lock = await loadImage(ASSETS.lockup);

    var canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext("2d");

    // --- background: light ice texture + soft top-down wash ---
    drawCover(ctx, tex, 0, 0, W, H);
    var wash = ctx.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, "rgba(244,249,252,0.55)");
    wash.addColorStop(1, "rgba(214,229,238,0.82)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    // --- lockup (centered, top) ---
    var lockH = 74, lockW = lockH * (lock.width / lock.height);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(lock, CX - lockW / 2, 118, lockW, lockH);
    ctx.globalAlpha = 1;

    // --- eyebrow ---
    ctx.textAlign = "center";
    ctx.fillStyle = TEAL;
    ctx.font = '800 30px ' + UI;
    track(ctx, 10);
    ctx.fillText("FINAL", CX, 300);
    track(ctx, 0);

    // --- result ---
    ctx.fillStyle = resultColor(data.result);
    ctx.font = '900 116px ' + DISPLAY;
    ctx.fillText(data.result, CX, 420);

    // --- score: "GF – GA", numbers ink, dash muted ---
    var gf = String(data.goalsFor), ga = String(data.goalsAgainst);
    ctx.font = '900 300px ' + DISPLAY;
    var nGf = ctx.measureText(gf).width, nGa = ctx.measureText(ga).width;
    ctx.font = '700 190px ' + DISPLAY;
    var dashW = ctx.measureText("–").width;
    var gap = 44;
    var total = nGf + gap + dashW + gap + nGa;
    var x = CX - total / 2;
    var scoreY = 690;
    ctx.textAlign = "left";
    ctx.font = '900 300px ' + DISPLAY;
    ctx.fillStyle = INK;
    ctx.fillText(gf, x, scoreY); x += nGf + gap;
    ctx.font = '700 190px ' + DISPLAY;
    ctx.fillStyle = DASH;
    ctx.fillText("–", x, scoreY - 30); x += dashW + gap;
    ctx.font = '900 300px ' + DISPLAY;
    ctx.fillStyle = INK;
    ctx.fillText(ga, x, scoreY);
    ctx.textAlign = "center";

    // --- matchup: crest / VS / crest with names ---
    var crestY = 860, colGap = 300;
    drawCrest(ctx, CX - colGap / 2, crestY, data.teamInitials, US);
    drawCrest(ctx, CX + colGap / 2, crestY, data.opponentInitials, THEM);
    ctx.fillStyle = INK_MUTE;
    ctx.font = '700 30px ' + DISPLAY;
    ctx.fillText("VS", CX, crestY + 12);
    ctx.fillStyle = INK;
    ctx.font = '700 32px ' + DISPLAY;
    ctx.fillText(ellipsize(ctx, (data.teamName || "US").toUpperCase(), 300), CX - colGap / 2, crestY + 108);
    ctx.fillText(ellipsize(ctx, (data.opponentName || "THEM").toUpperCase(), 300), CX + colGap / 2, crestY + 108);

    // --- meta line ---
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.85;
    ctx.font = '600 27px ' + UI;
    track(ctx, 1.5);
    ctx.fillText((data.metaLine || "").toUpperCase(), CX, 1050);
    track(ctx, 0);
    ctx.globalAlpha = 1;

    // --- divider ---
    ctx.strokeStyle = "rgba(14,24,38,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W * 0.11, 1120);
    ctx.lineTo(W * 0.89, 1120);
    ctx.stroke();

    // --- three stats ---
    var stats = [
      { value: data.shotsFor + "–" + data.shotsAgainst, suffix: "", label: "Shots", color: INK },
      { value: data.svPct, suffix: "", label: "Save %", color: INK }
    ];
    if (data.teamRating != null) {
      stats.push({ value: String(data.teamRating), suffix: "/100", label: "Team Rating", color: TEAL });
    } else {
      stats.push({ value: data.shotShare, suffix: "%", label: "Shot Share", color: INK });
    }
    var statY = 1230;
    var slotW = (W * 0.78) / 3, first = CX - slotW;
    for (var i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(0, statY);
      drawStat(ctx, first + slotW * i, stats[i].value, stats[i].suffix, stats[i].label, stats[i].color);
      ctx.restore();
    }

    // --- footer (the growth CTA) ---
    ctx.fillStyle = INK_MUTE;
    ctx.font = '600 26px ' + UI;
    track(ctx, 2);
    ctx.fillText("TRACKED WITH SMART TEAM TRACKER", CX, 1840);
    track(ctx, 0);

    return await new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error("canvas.toBlob returned null"));
      }, "image/jpeg", 0.92);
    });
  }

  // Native canvas letter-spacing (Chrome 99+, Safari 17.4+); ignored gracefully
  // on older engines — text stays readable, just without the tracking.
  function track(ctx, px) {
    try { ctx.letterSpacing = px + "px"; } catch (e) { /* unsupported: no-op */ }
  }

  async function share(data) {
    var blob = await render(data);
    var fileName = "recap-" + (data.fileTag || "game") + ".jpg";
    var file = new File([blob], fileName, { type: "image/jpeg" });

    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: "Game Recap" });
        return { ok: true, method: "share" };
      } catch (e) {
        if (e && e.name === "AbortError") return { ok: false, method: "cancelled" };
        // fall through to download
      }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, method: "download" };
  }

  window.STTShareCard = { render: render, share: share };
})();
