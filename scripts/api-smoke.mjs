#!/usr/bin/env node
//
// API smoke test for Smart Team Tracker's serverless surface.
//
// Why this exists: api/*.js is never exercised locally — dev_server.py is a
// Python reimplementation of the same routes, so a Node-only or Vercel-only
// fault is invisible until production. That gap shipped a broken spectator
// share link (both endpoints returning FUNCTION_INVOCATION_FAILED) that went
// unnoticed for days. Run this against a deployment before trusting it.
//
// Usage:
//   node scripts/api-smoke.mjs                        # production, read-only
//   node scripts/api-smoke.mjs <base-url>             # a preview deploy
//   node scripts/api-smoke.mjs <base-url> --writes    # + write-path checks
//
// Read-only by default and safe to run against production: every check is a
// GET or OPTIONS. --writes creates and then deletes a real guest game row, so
// only use it deliberately. See WRITE CHECKS below.

const DEFAULT_BASE = "https://smartteamtracker.vercel.app";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) || DEFAULT_BASE).replace(/\/$/, "");
const runWrites = args.includes("--writes");

let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n          ${detail}`);
  }
}

async function get(path, options = {}) {
  const res = await fetch(`${base}${path}`, { redirect: "manual", ...options });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    type: res.headers.get("content-type") || "",
    shareError: res.headers.get("x-stt-share-error"),
    buf,
    text: buf.toString("utf8"),
  };
}

// Every endpoint, with the status an unauthenticated caller should receive.
// A 5xx anywhere is the failure class this script exists to catch.
const READ_CHECKS = [
  { path: "/api/ping", status: 200, type: "application/json" },
  { path: "/api/teams", status: 401, type: "application/json", note: "auth required" },
  { path: "/api/opponents", status: 400, type: "application/json", note: "missing team_id" },
  { path: "/api/games", status: 200, type: "application/json", note: "guest-scoped" },
  { path: "/api/live-game", status: 400, type: "application/json", note: "missing code" },
  { path: "/api/live-game?code=SMOKE_NOPE", status: 404, type: "application/json" },
  { path: "/api/end-season", status: 405, type: "application/json", note: "POST only" },
  { path: "/api/save-game", status: 405, type: "application/json", note: "POST only" },
  { path: "/api/spectator-share", status: 200, type: "text/html" },
  { path: "/api/spectator-share?live=SMOKE_NOPE", status: 404, type: "text/html" },
  { path: "/api/spectator-preview", status: 200, type: "image/png" },
  { path: "/api/spectator-preview?live=SMOKE_NOPE", status: 404, type: "image/png" },
];

async function main() {
  console.log(`\nAPI smoke test -> ${base}`);
  console.log(`Mode: ${runWrites ? "read + WRITE" : "read-only"}\n`);

  console.log("Endpoint contract");
  for (const c of READ_CHECKS) {
    let r;
    try {
      r = await get(c.path);
    } catch (err) {
      check(`${c.path}`, false, `request threw: ${err.message}`);
      continue;
    }
    const label = `${c.path}${c.note ? `  (${c.note})` : ""}`;
    if (r.status >= 500) {
      check(label, false, `5xx: ${r.status} — ${r.text.slice(0, 120).replace(/\s+/g, " ")}`);
      continue;
    }
    check(
      label,
      r.status === c.status && r.type.includes(c.type),
      `expected ${c.status} ${c.type}, got ${r.status} ${r.type}`
    );
  }

  console.log("\nCORS preflight");
  for (const path of ["/api/teams", "/api/opponents", "/api/save-game", "/api/games"]) {
    const r = await get(path, { method: "OPTIONS" });
    check(`OPTIONS ${path}`, r.status === 200, `expected 200, got ${r.status}`);
  }

  // The spectator share card is the growth loop: if the renderer throws, the
  // handlers degrade to a static fallback and set X-STT-Share-Error. A green
  // status alone would hide that, so assert we're on the real render path.
  console.log("\nSpectator share card");
  const preview = await get("/api/spectator-preview");
  check(
    "preview is a real PNG",
    preview.buf.subarray(0, 4).toString("hex") === "89504e47",
    `magic bytes: ${preview.buf.subarray(0, 4).toString("hex")}`
  );
  check(
    "preview is fully composited (>50KB)",
    preview.buf.length > 50_000,
    `only ${preview.buf.length} bytes — likely a placeholder`
  );
  check(
    "preview not using degraded fallback",
    !preview.shareError,
    `X-STT-Share-Error: ${preview.shareError}`
  );

  const share = await get("/api/spectator-share");
  check(
    "share page points og:image at the renderer",
    share.text.includes("/api/spectator-preview"),
    "og:image does not reference /api/spectator-preview"
  );
  check(
    "share page not using degraded fallback",
    !share.shareError,
    `X-STT-Share-Error: ${share.shareError}`
  );

  // P0.9: the API must derive user identity server-side only. An anonymous
  // caller passing ?user_id= must stay scoped to guest rows (user_id null)
  // rather than reading someone else's season.
  console.log("\nP0.9 — server-side identity only");
  for (const q of ["user_id=smoke-fake-uid", "user_id=*", "user_id=is.not.null", "user_id=eq.anything"]) {
    const r = await get(`/api/games?${q}`);
    let body;
    try {
      body = JSON.parse(r.text);
    } catch {
      check(`?${q} ignored`, false, `non-JSON response: ${r.text.slice(0, 80)}`);
      continue;
    }
    const anonymous = await get("/api/games");
    const baseline = JSON.parse(anonymous.text);
    check(
      `?${q} does not widen scope`,
      r.status === 200 && JSON.stringify(body.games) === JSON.stringify(baseline.games),
      `client user_id altered the result set (${(body.games || []).length} vs ${(baseline.games || []).length} rows)`
    );
  }

  // WRITE CHECKS — opt-in. Creates a real guest game row, reads it back to
  // prove the client-supplied user_id was discarded, then deletes it. Skipped
  // by default so the script stays safe to point at production.
  if (runWrites) {
    console.log("\nWrite path (--writes)");
    const marker = `SMOKE-${process.env.SMOKE_TAG || "manual"}`;
    let createdId = null;
    try {
      const payload = {
        game: {
          // Claim someone else's id; the server must ignore this outright.
          user_id: "smoke-fake-uid-should-be-discarded",
          opponent: marker,
          goalsFor: 0,
          goalsAgainst: 0,
          date: new Date().toISOString().slice(0, 10),
        },
      };
      const res = await fetch(`${base}/api/save-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      check("guest save accepted", res.status === 200 && body.success, `got ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
      createdId = body.id || null;

      const readback = await get("/api/games");
      const rows = JSON.parse(readback.text).games || [];
      const found = rows.find((g) => g.id === createdId);
      check(
        "row stored under guest scope, not the claimed uid",
        !!found,
        "row was not visible in guest scope — client user_id may have been honoured"
      );
    } finally {
      if (createdId) {
        const del = await fetch(`${base}/api/games?id=${encodeURIComponent(createdId)}`, { method: "DELETE" });
        check("test row cleaned up", del.status === 200, `DELETE returned ${del.status} — row ${createdId} may need manual removal`);
      }
    }
  } else {
    console.log("\nWrite path: \x1b[33mskipped\x1b[0m (pass --writes to include; creates and deletes a real row)");
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}\n      ${f.detail}`);
    process.exit(1);
  }
  console.log("All checks green.\n");
}

main().catch((err) => {
  console.error("\nsmoke test crashed:", err);
  process.exit(1);
});
