#!/usr/bin/env node
// P3.4a — regenerate the static og:image fallback for spectator-share.html.
// Renders the waiting-state ("STARTING SOON") card through the same compositor
// the dynamic endpoint uses, so the static preview always matches the live art.
//
// Run after bake_share_assets.py:
//   node outputs/brand/share-template/render_static_preview.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildShareModel, renderPreviewPng } from "../../../api/spectator-share-lib.js";

const model = buildShareModel(null, "");
const png = renderPreviewPng(model);
const out = fileURLToPath(new URL("../../../assets/share/preview-static-1200x630.png", import.meta.url));
writeFileSync(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(1)} KB)`);
