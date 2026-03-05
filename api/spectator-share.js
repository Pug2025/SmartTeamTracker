import { buildShareModel, fetchLiveSnapshot, getBaseUrl, renderShareHtml } from "./spectator-share-lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const code = String(req.query.live || req.query.code || "").trim();
  const snapshot = code ? await fetchLiveSnapshot(code).catch(() => null) : null;
  const model = buildShareModel(snapshot, code);
  const html = renderShareHtml({ model, baseUrl: getBaseUrl(req) });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(snapshot || !code ? 200 : 404).send(html);
}
