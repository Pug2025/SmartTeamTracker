import { buildShareModel, fetchLiveSnapshot, getBaseUrl, renderShareHtml } from "./spectator-share-lib.js";

// Minimal, dependency-free share page. Used when the rich renderer throws, so a
// shared link always opens the game rather than returning a 500.
function renderFallbackHtml(baseUrl, code) {
  const openUrl = `${baseUrl}/?live=${encodeURIComponent(code)}`;
  const image = `${baseUrl}/assets/share/preview-static-1200x630.png`;
  const safe = openUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Live Spectator View | Smart Team Tracker</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="SmartTeamTracker" />
<meta property="og:title" content="Live Spectator View" />
<meta property="og:description" content="Follow the game live with score, momentum, and the live game feed." />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${safe}" />
</head>
<body><a href="${safe}">Open spectator view</a>
<script>window.location.replace(${JSON.stringify(openUrl)});</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const code = String(req.query.live || req.query.code || "").trim();
  let baseUrl = "";

  try {
    baseUrl = getBaseUrl(req);
    const snapshot = code ? await fetchLiveSnapshot(code).catch(() => null) : null;
    const model = buildShareModel(snapshot, code);
    const html = renderShareHtml({ model, baseUrl });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(snapshot || !code ? 200 : 404).send(html);
  } catch (error) {
    // Never hard-fail a shared link: degrade to the static card + redirect, and
    // surface the cause in the Vercel log and a response header for diagnosis.
    const message = error && error.message ? String(error.message) : String(error);
    console.error("spectator-share failed:", message, error && error.stack);
    if (!baseUrl) {
      const proto = req.headers["x-forwarded-proto"] || "https";
      baseUrl = `${proto}://${req.headers["x-forwarded-host"] || req.headers.host || ""}`;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-STT-Share-Error", message.slice(0, 180).replace(/[^\x20-\x7E]/g, " "));
    return res.status(200).send(renderFallbackHtml(baseUrl, code));
  }
}
