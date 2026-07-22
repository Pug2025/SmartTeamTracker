# Baseball Module: Build Roadmap

Sequenced build plan for the baseball scorebook described in `BASEBALL_PLAN.md`. Phases are ordered by dependency and by how much risk they remove. Read the plan first for the what and why; this doc is the how and in what order.

Two things about this roadmap:
- **Greenfield, not edits.** Unlike the hockey roadmaps, there is no existing code to modify, so each phase names files and functions to *create*. Early phases build the skeleton and engine; later phases add vocabulary and polish.
- **Rolling-wave detail.** Phases 0 and 1 are specified in full. Phases 2 to 6 are sketched and will be fleshed out as we reach them, because their detail will change once the early phases are real. Deferred items are listed but not planned.

Each phase ships a version bump on its own track (`bb-v0.1`, `bb-v0.2`, ...), separate from the hockey app's `v6.x`.

---

## Assumptions (from plan section 17, my recommendations)

These are baked in below. Overruling any is cheap; say so and I adjust the affected phase.
- **Entry point:** a separate page in this repo (`baseball.html` plus `js/baseball/*`), sharing the existing `/api`, auth, and Supabase.
- **Schema:** add a `sport` column to `teams` (default `hockey`); hoist `sport` to a top-level `games` column.
- **Sport accent:** infield-clay burnt-orange (`#D9772E` family), exact hex tuned in Phase 0.
- **Pitch limits:** editable settings with seeded defaults, confirmed against Jamie's league later.
- **Opponents:** stored by team name plus jersey numbers, reusing the `opponents` table.

---

## Working setup: keeping hockey and baseball from colliding

Hockey development continues on `main` at the same time as baseball. To stop two parallel chats from clobbering each other's uncommitted work, isolation happens at three layers. All three are required; branching alone is not enough.

### Layer 1 — Separate branch in its own folder (git worktree)

A folder can only have one branch checked out, so simultaneous work needs two folders sharing one history.

- **Hockey:** `/Users/jamie/SmartTeamTracker` on branch `main` (unchanged).
- **Baseball:** `/Users/jamie/SmartTeamTracker-baseball` on branch `baseball`.

One-time setup, run from the hockey folder (all local, nothing pushed):

```bash
git add BASEBALL_PLAN.md BASEBALL_ROADMAP.md
git commit -m "Baseball: product plan and build roadmap"
git branch baseball
git worktree add ../SmartTeamTracker-baseball baseball
```

Open the baseball folder in its own Claude session. The two folders physically cannot touch each other's files.

### Layer 2 — File separation

- Baseball lives in its own files: `baseball.html`, `js/baseball/*`, `css/baseball.css`.
- Baseball never edits `index.html`, `js/app.js`, or `css/styles.css`.
- Baseball copies the design tokens into `css/baseball.css` rather than importing from `styles.css`. Small duplication now, zero coupling; de-duplicated at integration time.

### Layer 3 — Shared backend and database

Both apps use one Supabase database, so isolation must extend to data.

- Additive only: baseball adds a `sport` column and new endpoints, never alters or removes anything hockey uses.
- Hockey needs one deliberate, one-time change on `main`: filter its team and game queries to `sport = 'hockey'` (existing null rows count as hockey), so baseball rows never appear in the hockey app.
- Until that filter ships, test baseball under a guest or separate account so it does not write into real hockey data.

### Rules of the road

1. One sport per folder per chat. Check the folder name before starting.
2. Never cross-edit. The baseball chat does not touch hockey files, and the reverse.
3. Commit often in each folder so switching is always safe.
4. Periodically merge `main` into `baseball` to absorb hockey token and API changes. Never merge `baseball` into `main` until integration is a deliberate decision.
5. Baseball deploys from its branch to its own Vercel preview URL; `main` stays hockey production.

---

## Phase 0 — Foundations and the baseball skin (`bb-v0.1`)

**Why first:** the cheapest way to confirm the reuse works and to see the baseball look on a real screen before building any logic. Nothing here is throwaway.

### 0A. Entry point and shared design system

**What we build:**
- `baseball.html`: a minimal single-page shell, same head and PWA meta pattern as `index.html`.
- Reuse the design tokens: import the existing token layer (the `:root` variables from `css/styles.css`) so baseball inherits the surfaces, type scale, radii, shadows, and motion. New file `css/baseball.css` holds only baseball-specific overrides.
- Bundle nothing new for fonts; reference the Saira Semi Condensed and Hanken Grotesk already in the repo.

**Files:** `baseball.html`, `css/baseball.css`, `js/baseball/app.js` (entry).

**Data changes:** none yet.

**Test:** `baseball.html` loads on a phone, renders on the dark canvas, and the two bundled fonts show correctly.

### 0B. The sport accent

**What changes:** define the baseball accent token (`--clay` and `--clay-deep` for gradients) in `css/baseball.css`, and point the primary button gradient and active states at it instead of ice teal. Keep blue, red, green, amber untouched.

**Test:** a primary button and an active chip render in clay, side by side with an unchanged win-green pill, and all four semantic colors remain distinct.

### 0C. Sport picker front door

**What we build:** the opening screen with two tiles, Baseball (live) and Hockey (coming soon). Selecting Baseball routes into the baseball shell.

**Function:** `renderSportPicker()` in `js/baseball/app.js`.

**Test:** picker loads, Baseball is tappable with press-scale feedback, Hockey shows a disabled "coming soon" state.

### 0D. The one schema change

**What changes:** add `sport TEXT DEFAULT 'hockey'` to the `teams` table and `sport TEXT` to `games`. Extend `api/teams.js` validation to accept and return `sport`. Existing hockey rows are untouched by the default.

**Files:** Supabase migration (SQL, run once), `api/teams.js`.

**Test:** an existing hockey team still loads; a new team can be written with `sport: 'baseball'` and reads back correctly.

---

## Phase 1 — The walking skeleton (`bb-v0.2`)

**Why second, and why a vertical slice:** this is the highest-information step. It proves the hardest screen (live game) and the engine spine (event log) together, end to end but narrow. When it works, you can score a half-inning on your phone, which validates the entire concept and tells us what to fix before we scale up.

Scope is deliberately limited to a **subset of events**: single, generic out (one fielder tap), walk, strikeout, and run scored, plus undo. No double plays, no baserunning UI, no full outcome list yet. Those come in Phase 2.

### 1A. Minimal event-log engine

**What we build:** the append-only event log and the replay-to-state reducer.
- `appendEvent(event)` pushes to the log.
- `computeState(log)` replays the log into derived state: inning, half, outs, count, base occupancy, score.
- `undo()` drops the last event and recomputes.

**Files:** `js/baseball/engine.js`.

**Data changes:** in-memory only this phase (no save yet).

**Test:** feed a scripted list of events, assert the derived outs, count, bases, and score are correct; call `undo()` and assert state rewinds exactly.

### 1B. Live-game scoreboard and situation cluster

**What we build:** reuse the hockey scoreboard component (them versus us, big run values, sub-line) and add a compact situation cluster: bases diagram, outs dots, and the ball-strike count.

**Functions:** `renderScoreboard(state)`, `renderSituation(state)`.

**Test:** the scoreboard reflects `computeState()` output; changing the state updates runs, hits, outs, count, and the bases diagram.

### 1C. The diamond and a minimal outcome pad

**What we build:**
- The SVG diamond with nine fielder nodes styled as jersey-chips (static positions, placeholder numbers this phase).
- An outcome pad with the five Phase 1 outcomes.
- Tapping "out" then a fielder node records a simple putout; the run button fires the run-scored flash.
- The always-visible undo control.

**Functions:** `renderDiamond(state)`, `renderOutcomePad()`, `onOutcome(code)`, `onFielderTap(pos)`.

**Test:** score a full half-inning using the five outcomes; outs advance and flip sides at three; undo reverses the last action; the run flash plays on a run.

**End-of-phase milestone:** one person can score a half-inning on a phone with working undo. This is the go/no-go checkpoint for the whole product.

---

## Phase 2 — Complete the scoring vocabulary (`bb-v0.3`) [sketch]

Full plate-appearance outcome set from plan 4.2, multi-tap fielder sequences with real notation (6-4-3, double play inference), the base-path runner surface for advancement and steals, and spray-location capture on balls in play. Acceptance: score a complete real game alongside a paper scorer and reconcile the box score.

## Phase 3 — Rosters, lineups, opponents, game setup (`bb-v0.4`) [sketch]

Numbers-only roster reusing the jersey-chip UI, continuous batting order, field-position assignment feeding the diamond, opponent-by-number, and the game-setup screen. Wire to the existing `/api/teams` and `/api/opponents`. Acceptance: build a team and an opponent, set a lineup, and start a game from real data.

## Phase 4 — Pitch count and kid-pitch rules (`bb-v0.5`) [sketch]

Live pitch counter with limit warning, run-per-inning cap, substitutions and re-entry, and playing-time capture. Acceptance: pitch warning fires at the configured threshold; a substitution updates the diamond and the playing-time tally.

## Phase 5 — Box score and season rollups (`bb-v0.6`) [sketch]

Compute batting, pitching, and fielding lines from the event log; aggregate across games; youth-friendly main views (Hits, Runs, RBI, OBP). Acceptance: a game's box score matches hand calculation; season totals sum correctly across games.

## Phase 6 — Persistence and field-test build (`bb-v1.0`) [sketch]

localStorage offline mirror plus sync through the existing `/api/save-game`, PWA install, data export, and deploy to a private test URL. Acceptance: score offline, regain signal, confirm the game synced and survives a reload on another device. Hand the link to friends.

---

## Deferred (not planned until testers validate the core)

- Opponent scouting views and spray charts (data captured from Phase 2).
- Playing-time and fairness report.
- Tee-ball and coach-pitch modes.
- High-contrast daylight theme.
- Spectator follow-along and share cards.
- Final art assets (plan section 8).
- Any synthesized player grade.
- Integration into the main Smart Team Tracker shell.

---

## How we work each phase

1. I build the phase against the tests above.
2. You run it and eyeball it on a phone.
3. We commit with a `bb-vX.Y` tag, the way your hockey phases commit.
4. We flesh out the next phase's detail, adjusting for what we just learned.
