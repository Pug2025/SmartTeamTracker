import { buildShareModel, fetchLiveSnapshot, renderPreviewPng, renderFallbackPng } from "./_spectator-share-lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const code = String(req.query.live || req.query.code || "").trim();

  try {
    const snapshot = code ? await fetchLiveSnapshot(code).catch(() => null) : null;
    const model = buildShareModel(snapshot, code);
    const image = renderPreviewPng(model);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.status(snapshot || !code ? 200 : 404).send(image);
  } catch (error) {
    // An og:image that 500s kills the link preview entirely, so fall back to the
    // un-composited branded template rather than erroring.
    const message = error && error.message ? String(error.message) : String(error);
    console.error("spectator-preview failed:", message, error && error.stack);
    try {
      const fallback = renderFallbackPng();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("X-STT-Share-Error", message.slice(0, 180).replace(/[^\x20-\x7E]/g, " "));
      return res.status(200).send(fallback);
    } catch {
      return res.redirect(302, "/assets/share/preview-static-1200x630.png");
    }
  }
}
