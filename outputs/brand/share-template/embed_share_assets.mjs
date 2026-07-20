// Embeds the baked share sprites (api/_share-assets/) into a JS module so the
// serverless renderer never touches the filesystem at runtime.
//
// Why: on Vercel, api/spectator-share.js and api/spectator-preview.js were the
// only two functions with a vercel.json `functions`/`includeFiles` entry, and
// the only two returning FUNCTION_INVOCATION_FAILED. Runtime readFileSync from
// a deployed function depends on file tracing + includeFiles + import.meta.url
// all resolving the same way, none of which is exercised locally (dev_server.py
// is a Python reimplementation). Static imports ARE traced reliably — _auth.js
// proves it — so the assets ride along in the module graph instead.
//
// Regenerate after re-running bake_share_assets.py:
//   node outputs/brand/share-template/embed_share_assets.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "api", "_share-assets");
const OUT = join(ROOT, "api", "_share-assets-embedded.js");

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const pngs = readdirSync(SRC).filter((f) => f.endsWith(".png")).sort();

const entries = pngs
  .map((f) => `  ${JSON.stringify(f)}: "${readFileSync(join(SRC, f)).toString("base64")}"`)
  .join(",\n");

writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
// Source: api/_share-assets/ · Regenerate:
//   node outputs/brand/share-template/embed_share_assets.mjs
//
// Base64 sprite payloads for the spectator og-image renderer. Embedded rather
// than read from disk so the deployed function has no filesystem dependency.

export const manifest = ${JSON.stringify(manifest)};

export const files = {
${entries}
};
`,
  "utf8"
);

const bytes = pngs.reduce((n, f) => n + readFileSync(join(SRC, f)).length, 0);
console.log(`embedded ${pngs.length} sprites (${(bytes / 1024).toFixed(0)}KB raw) -> ${OUT}`);
console.log(`output size: ${(readFileSync(OUT).length / 1024).toFixed(0)}KB`);
