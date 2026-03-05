import { buildShareModel, fetchLiveSnapshot, renderPreviewPng } from "./spectator-share-lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const code = String(req.query.live || req.query.code || "").trim();
  const snapshot = code ? await fetchLiveSnapshot(code).catch(() => null) : null;
  const model = buildShareModel(snapshot, code);
  const image = renderPreviewPng(model);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return res.status(snapshot || !code ? 200 : 404).send(image);
}
