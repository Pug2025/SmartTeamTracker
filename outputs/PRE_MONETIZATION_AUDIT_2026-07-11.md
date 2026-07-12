# Smart Team Tracker — Pre-Monetization Product Audit

**Date:** July 11, 2026
**Method:** Four parallel specialist audits (Functionality/QA, UX/Interaction, Visual Design & Brand, Hockey Domain & Analytics) plus a competitive benchmark study. Every lens combined hands-on use of the running app at a 375×812 phone viewport (guest mode, seeded with a full tracked game vs Napanee Stars and a second game vs Kingston Ice) with source-level verification (`index.html`, `js/app.js`, `js/teams.js`, `js/auth.js`, `js/spectator.js`, `css/styles.css`, `css/auth.css`, `api/*`, `manifest.json`, `service-worker.js`) and cross-referencing against all nine planning docs in the repo root. Items already scoped in those docs are marked **[previously scoped]**; everything else is a new finding.

---

## 1. Executive Summary

### Verdict

**Functionally, this is much closer to a sellable product than the roadmap docs suggest — but it is not ready to charge for yet.** Of the ~60 items scoped across ROADMAP.md, PRE_MONETIZATION_ROADMAP.md, STATS_UX_ROADMAP.md and the five feature plans, roughly **50 are verified implemented, most exactly to spec** (score explainers, PP/PK, per-goalie depth, opponent records, End Season, offline queue with retry/backoff, rate limiting, crypto IDs, account screen, onboarding, haptics). The scoring model recalibration is genuinely in the code (17/20 constants match SCORING_ROADMAP exactly) and holds up to hand-computed scenario testing in the mid-range. The domain lens' overall judgment: *a hockey-literate coach or parent would, on balance, trust this app — it reads as built by someone who actually stands at the glass.*

What blocks monetization is three clusters:

1. **A handful of data-integrity and trust-killing bugs** in the core loop — silent goal loss, a live-game wipe race, a save-percentage formatter that displays a shutout as `.000`, and a marketing page that hijacks mid-game reloads for guests. None is hard to fix; all are the kind of failure a paying coach screenshots and refunds over.
2. **The visual identity gap is real and now precisely diagnosed.** The app is anodyne by construction: its de-facto brand color is also the "US" data color, there are 287 distinct color literals against 15 tokens, four competing "success" greens, 21 font sizes with no numeral treatment in a numbers product, emoji icons (one broken) beside hand-rolled SVGs, no mark, no app icon (the manifest 404s), and — most tellingly — the only cohesive, personality-bearing design language in the product lives on the *free* spectator page, not the coach app that would carry the price tag.
3. **Monetization infrastructure doesn't exist yet** (expected — PRE 7C was explicitly deferred), and one API hole remains: anonymous callers can write games under any user ID.

**Recommended path:** one hardening sprint (§4 tier 1 — all small, all Claude-buildable), one design-system sprint (§4 tier 2, gated on three decisions from Jamie in §6), then pricing/paywall work. The competitive research (§7) strongly suggests the *parent/spectator side* is the natural payer — which makes the spectator surface's current polish an asset and the "name the team on the spectator page" fix strategically important, not cosmetic.

### Top 5 issues by severity

| # | Issue | Why it's top-5 |
|---|-------|----------------|
| 1 | **Silent goal loss in the Goal For chain.** The goal event is only committed after the scorer is chosen (`js/app.js:3362–3374`); a backdrop tap, Cancel, or reload during the scorer step discards the goal with zero feedback. The Goal Against context sheet has the mirror problem: backdrop-tap saves the goal untagged *and* silently kills the +/- and strength steps (`js/app.js:4381–4392`, `1431`). | Losing a logged goal is the single worst data event a stat app can have, and a gloved mis-tap on a dark backdrop is the *expected* rink input, not the edge case. |
| 2 | **Guest cold-load lands on the marketing page — even mid-game** — and one full live-game wipe was observed (suspected `save()`-before-`load()` race at init, `js/app.js:3423`, `3918`). Reload during a live game → full-screen "Get Started Free" sales pitch; recovery needs two precise taps. State restores — but the coach doesn't know that. | This is the trust-killer cluster for the exact moment (rink WiFi blip) the product is built around. |
| 3 | **A perfect save percentage renders as `.000`** — `(saves/sa).toFixed(3).slice(1)` truncates `1.000` at ~10 coach-side call sites (`js/app.js:812, 2118, 2448, 2571, 3114, 4556, 5631, 6531…`). HD SV% hits it constantly (small denominators are often perfect). The spectator page formats it correctly — the fix already exists in `js/spectator.js:654–658`. | A goalie's best game displays the worst possible number, on the stat this app is named for. |
| 4 | **Two broken monetization-critical surfaces:** the End Season modal opens *behind* the Manage Teams modal (both z-index 9999, wrong DOM order; handler never closes the parent — `js/app.js:4080ff`), making the flow effectively dead to touch users; and `manifest.json` references `/icon-192.png`, `/icon-512.png` and the SW pre-caches `/favicon.ico` — none exist, so PWA install (the "app" in this app) is broken. | Both are invisible in dev, fatal in the first week of paid use. |
| 5 | **Brand identity absent by construction** (full diagnosis in §3): accent = data color, token entropy, emoji iconography, no wordmark/mark/app icon, identity stranded on the spectator surface, and the product never celebrates the user (the "money screen" post-game summary ends on a red **Delete Game** button). | This is the "why does it feel generic" answer, and it's the perceived-value gap between "free hobby tool" and "$60/yr product." |

**Honorable mentions (would be top-5 in a narrower audit):** the "No Assist" button can never appear — a `hidden` class beats the inline display style (`index.html:1078` vs `css/styles.css:1980`), so every unassisted goal is recorded as assist-unknown, silently corrupting the assist stats coaches would pay for; status toasts stick forever under a rAF/setTimeout race (`js/app.js:771–781`); `api/save-game` trusts client-supplied `user_id` for anonymous callers (`api/save-game/index.js:47`); and the xG display contradicts the goalie model's own youth-level expectations (details in §2.7 and §4).

---

## 2. Screen-by-Screen Inventory

Each screen assessed through all four lenses. ✅ = works well · ⚠️ = rough · ❌ = broken.

### 2.1 Landing page (marketing)
- ✅ **Copy and honesty are genuinely strong.** "Know how your team really played." is a real positioning line; the sample summary card's numbers *actually reproduce through the real scoring model* (the domain lens verified the mockup's 85 goalie score from its own displayed stats) — rare marketing integrity.
- ❌ Feature icon row is emoji, and one glyph is broken: `&#129945;` (U+1FB99, a legacy-computing block) renders as tofu next to "Real Goalie Evaluation" (`index.html:458`) — likely a typo for 🥅.
- ⚠️ Desktop (1280px) is the same 420–480px phone column floating on flat black (`css/auth.css:206–266`) — no art direction for the surface parents hit from a shared link on a laptop.
- ⚠️ Ring sublabel "Strong" (`index.html:74`) isn't one of the app's actual bands (Excellent/Solid/Below Average/Poor); the mockup's feed says "Goal against" while the real spectator feed prints an enthusiastic "GOAL!" for *opponent* goals (`js/spectator.js:550–553`) — the mockup's wording is better; port it into the product.
- ⚠️ [Domain] The word **"objective"** ("objective performance score") oversells a model driven by judgment-call tags. Help already handles this honestly ("the model trusts your observations"); marketing should say "consistent" or "context-aware."
- ⚠️ For guests, this page is also finding #2's landmine: every cold load goes through it, even with a live game in progress.

### 2.2 Auth screen
- ✅ Clean, unified branding ("Smart Team Tracker" everywhere — PRE 3A done); Google button is ironically the most polished element on the screen (real brand SVG).
- ✅ Guest path is honest: "Guest data is stored on this device only and cannot be synced."
- ⚠️ That honesty is then contradicted by the Account modal showing guests "Cloud sync: Synced" (§2.11).
- ⚠️ "Continue as Guest" falls below the fold on smaller screens.

### 2.3 Game Setup (de-facto home)
- ✅ Contextual gating is well done: requirement chip + copy change per state, Start Game hidden until a team exists (ROADMAP 2A family), resume banner for in-progress games, calendar icon (4B), Track +/- under OPTIONS (2C), feature pills (1C) — all verified implemented.
- ✅ Opponent autocomplete with last-played dates is coach-friendly.
- ⚠️ Redundant messaging still stacks in the empty state: "TEAM REQUIRED" chip + team card copy + two hint lines ("Add a team, then enter the opponent to start." / "Select or create a team first, then add an opponent.") say the same thing four ways.
- ⚠️ The three data pills open panels **stacked inline 1–2 screens below the fold with no scroll and no pill active-state** (`js/app.js:5265`); all three open = a ~3,100px page. Orientation is scrolling-only.
- ⚠️ Opponent records are created the moment a game starts and survive game deletion; the saved-opponent × delete has no confirm.

### 2.4 Manage Teams / team form
- ✅ Team rows with Edit / End Season / Del; blur backdrop; goalies field (GOALIE_PLAN) present.
- ❌ **End Season modal opens behind this modal** — top-5 issue #4.
- ❌ **Roster editing is still raw "one # per line" textareas** — PRE 4B, the roadmap's own "clearest developer-tool artifact in the product," is the biggest scoped item that remains unbuilt.
- ⚠️ Three competing outline-button styles in one row (gray/blue/red); "End Season" wraps to two lines at 375px; red **Del** sits 8px from it.
- ⚠️ `goalieAddInput` lacks `inputmode="numeric"` while the roster input has it (`index.html:1055`) — wrong keyboard for jersey numbers.

### 2.5 Live game screen (the core product)
- ✅ **The two-column THEM/US grid is the app's genuine visual signature and its best interaction design**: 171×60px primaries, red/blue zone tints, correct hierarchy vs context buttons (ROADMAP 1A), amber Next Period (2E), distinct goal haptics (3C), period-end flash summary (3A), undo FAB with hold-for-list, sticky header with SV% (1B), goalie chip + Switch (GOALIE_PLAN), period elapsed time (STATS_UX 2C). All verified.
- ❌ Goal chains: top-5 issue #1 (silent loss on backdrop/cancel/reload; GA has "Tag Later" but no Cancel; strength picker says "(required)" yet offers Skip).
- ❌ "No Assist" is permanently hidden (`index.html:1078` `hidden` class beats `openPicker`'s inline style, `js/app.js:3310`) → unassisted goals pollute assist data.
- ⚠️ **Everything above the grid fails the glove test**: period chips are live 26×23px targets with ~0 gap (a mis-tap silently re-buckets subsequent events), goalie Switch is 57×21, Share Live 85×28.
- ⚠️ First logged event inserts the Chance Quality bar and shifts the whole grid ~85px mid-game; the "Not enough data yet" placeholder state already exists — render it at fixed height from the start.
- ⚠️ Quick-tap undo removes an entire goal chain with only a haptic — no "Undid: Goal #9" label, no redo, and `undo()` never calls `save()` (`js/app.js:1240–1247`).
- ⚠️ "End Game & Score" is at the bottom of a ~2,100px page, fires with **no confirm**, and auto-saves — while harmless "New Game" *does* confirm.
- ⚠️ Switch-goalie flow is inverted vs its own plan (red confirm dialog *before* the picker; GOALIE_PLAN locked it as picker-then-confirm) — an alarm-colored two-modal flow for a routine action.
- ⚠️ Tap-registered feedback is 9px header text; the event feed (the only "what did I just log" surface) is at the very bottom. A one-line last-event ticker under the goalie chip would close this.

### 2.6 Post-game summary / Game Detail modal (the money screen)
- ✅ **Excellent depth, and almost everything scoped is built**: real team names + W/L tag (8E), score rings with "How is this scored?" expanders and correct weights (1B/1C), "Save Quality" rename (1B), Focus-area takeaway (STATS_UX 2B), component bars with pastel thresholds (4J), BY GOALIE table with HD SV% / Reb Ctrl / Soft% (GOALIE_DEPTH), Special Teams PP%/PK% (2A), by-period table, player stats with verified-correct +/-, historic Game Detail is the same full view with working prev/next (STATS_UX 1A/1B).
- ❌ SV% `.000` bug lands here hardest (HD SV% column especially); the same table mixes `—` and `.000` for no-data.
- ⚠️ The screen **ends on a red Delete Game button** — the emotional close of the best screen in the product is destruction. Title truncates ("Kingston Ice — 202…") at 375px.
- ⚠️ Confidence dampening is active below 20 shots but disclosed only below 10 (`js/app.js:2626–2634`) — PRE 1D shipped weaker than spec, and the stale comment at `js/app.js:1908` misdescribes the ramp.
- ⚠️ Dampening note absent for 10–19 shots; "Goalie change: P2" annotation (STATS_UX 3E) not built.
- ⚠️ Jargon density: xGA/xGF/HD/OMR appear unexplained in tiles; the in-game header (period chips, Switch) stays rendered and interactive above the summary — confusing dual state.
- ⚠️ ~101 inline `style=""` attributes in `index.html` plus repeated inline styles from `renderSummaryScreen()` — PRE 4I remains open.

### 2.7 Scoring model (cross-cutting, domain lens)
- ✅ **SCORING_ROADMAP is genuinely implemented**: 17/20 constants exact (sigmoid 63/35 mirrored curve `js/app.js:1805–1815`, big save 0.6 `:1851`, rebound 0.25 `:1903`, progressive soft goals `:1877`, PP GA discount `:1884–1886`, team weights `:1991`, danger weights `:1949–1954`, xG/shot quality `:1961–1964`, PP/SH GF weights `:1973–1976`, ring thresholds `:2104`). Scenario testing: mid-range is well calibrated (dominant 2–3 loss → 69; lucky 3–2 win → 44 — exactly the story a good coach tells the room).
- ❌ **The xG display contradicts the goalie model.** `XG_RATES` (`js/app.js:1763–1767`) uses NHL-ish rates (normal 7%, HD 18%) while `LEVEL_PROFILES` (`:1753–1760`) says a U11 goalie allows 20%. Same 25-shot game: xGA tile ≈ 2, goalie model expects ≈ 5. The first analytics-literate parent who lines those tiles up will call it out. Fix: derive XG_RATES per level from LEVEL_PROFILES, or relabel xG as a unitless "Chance Quality" index.
- ⚠️ **Extremes are compressed**: an untagged 30-save shutout caps at ~89 (roadmap target A+ ~95) → "my kid got a shutout and you gave him 87" complaints; and confidence dampening pulls disasters *up* (5 GA on 15 shots → 51 vs target F). Deviations from roadmap: sigmoid coeffs 0.7/0.5 vs ~0.55/~0.45 spec'd; ramp starts at 2 shots not 5.
- ⚠️ Smaller model nits: PP override collapses the progressive soft-goal scale (3rd PK softie weighs less than a 2nd evens softie); +/- credits PP goals-for against hockey convention (`js/app.js:1731–1742`); team no-data returns 50 (red) while goalie no-data returns 63 (orange); missed chances inflate the xG numerator asymmetrically (`:1787–1788` vs `:1961–1962`); the Key Takeaway's "Danger Control" advice cites HD chances but the component is computed from rushes/turnovers (`:2545–2547` vs `:1949–1956`).
- ✅ LEVEL_PROFILES baselines (U9 .75 → U18 .89) are realistic for youth progression.

### 2.8 Past Games / By Opponent
- ✅ Filter bar exactly to plan including locked empty-state copy ("No wins yet this season."); humanized score labels ("Goalie: 66 · Team: 49" — PRE 3D done); By Opponent grouping with records and inline expansion; skeletons and failure copy present.
- ⚠️ Swipe-to-delete is gesture-only and instruction-dependent (Delete-with-confirm in the modal covers it).
- ⚠️ Loss scores use the same red as destructive actions (see §3).

### 2.9 Season Dashboard
- ✅ Record, recent form with scores (STATS_UX 6B), PP%/PK% tiles, BY GOALIE season rates, season selector correctly hidden until a past season exists, Reset Season confirm copy correct (current-season-only).
- ⚠️ Dense 3-column KPI grid all at one elevation; 8-column BY GOALIE table cramped at 375px; SV% shown as "91.2%" here vs ".917" per-game — two formats for the hockey stat with the strongest formatting convention.
- ⚠️ "Reset Season" (destructive) sits in the panel header adjacent to Close, in both this and Player Stats headers.
- ⚠️ PK% shows "— No PK" while the strength table right beside it shows an SH goal against (denominator = logged penalties only; `js/app.js:2499–2506`, `6472–6476`) — and the "approx." footnote STATS_UX 2A promised is not rendered.

### 2.10 Player Stats
- ✅ Leader tiles, six-way sort, per-player cards with GP and last-5 form, "New" badges.
- ⚠️ 2-game sparklines render as meaningless straight diagonals; goalies appear in the skater list; sparkline blue is #4da3ff again (brand=data problem).

### 2.11 Menu / Account / Help
- ✅ Account screen (PRE 7A) built and solid for guests: guest banner, Export All Data, queued-sync count; guest→account migration code exists (PRE 7B, `js/app.js:3963–4030`); Help weights now correct (PRE 1C), subjective-tags note verbatim (1E).
- ⚠️ Guests see "Cloud sync: Synced" directly above "Sign in to sync your data" — contradictory exactly where the account upsell will live. (Guest games *are* in fact POSTed anonymously to the API — see 2.13.)
- ⚠️ Guests can open End Season, but `api/end-season.js:36` will 401 them after they commit — should be gated or messaged up front.
- ⚠️ Help is a competent text wall; no visuals in a product whose pitch is visual scoring.

### 2.12 Spectator view (the growth loop)
- ✅ **Structurally excellent v1** and the best-designed surface in the product: LIVE pill, 3s poll, "Updated" stamp, stale-feed indicator, FINAL handling, T–U axis labels (5A), feed anchor (4D), goal celebration + score-bump animations, tabular numerals, its own coherent steel-blue ramp.
- ❌ **The tracked team is never named.** Headline = opponent + level ("Napanee Stars • U11"); our side is just "US" (`js/spectator.js:291–297`). Grandma is watching a page apparently about the other team. Given the parent-pays benchmark finding, this is the most strategically important small fix in the audit.
- ⚠️ Chance Quality asserts "They are getting the better looks" off a single shot — no sample-size guard (`js/spectator.js:401–424`) though Momentum has one (`:459–461`).
- ⚠️ Scoreboard overflows a 375px viewport (right card clipped; `css/styles.css:2722`); ended shares look identical to never-started ones ("Waiting for coach…" + LIVE badge); stale indicator fires at 120s vs the 30s scoped (PRE 5B); "1 shots"; `<title>` title-cases the opponent; the "just joined" context card (ROADMAP 3B / PRE 5C) is the one spectator item **not implemented**.
- ⚠️ SV% jargon unexplained for the grandparent audience (it *does* format 1.000 correctly — the coach side should copy its formatter).

### 2.13 PWA shell, API & platform
- ❌ Manifest icons and favicon don't exist (top-5 #4) — install-to-home-screen is broken; `theme_color` #000000 mismatches the actual #030507+ surfaces.
- ⚠️ `api/save-game/index.js:47`: `verifiedUserId = uid || game.user_id || null` — anonymous callers can insert rows under any uid; `api/games/index.js:22,34` honors client `user_id` for guests. Token verification, DELETE scoping, end-season auth, and rate limiting are otherwise solid (PRE 2A/2C substantially done); crypto randomness done (PRE 2B); localStorage quota handled (2D); offline queue has 3-try backoff + indicator + tap-to-retry (6D).
- ⚠️ No URL routing at all (no pushState/hash): Android back exits the app from any modal; no deep links.
- ⚠️ Accessibility floor: interactive DIVs without roles (`.pickerBtn`, `.p-opt`, `#btnUndo`), 11 aria attributes in 1,607 lines, no dialog semantics/focus traps. (Positives: safe-area insets, `prefers-reduced-motion`, `touch-action: manipulation`, rink-appropriate 0.08–0.3s animations.)
- ⚠️ Dev artifacts served publicly: `calibration.html`, `spectator-preview.svg`, `spectator-share.html`; the og-image SVG spells the name "SmartTeamTracker" (missed by PRE 3A).
- ✅ Zero console errors across an entire multi-hour interactive session — genuinely clean runtime.

---

## 3. Design & Brand Identity Gap Analysis — why it feels anodyne

Seven named mechanics, each with evidence. This is the section to read before any redesign conversation.

1. **The brand color is a data color.** `#4da3ff` is simultaneously the logo (`auth.css:216`), the CTA fill (`auth.css:239`), focus rings, links, toggle fills, sparklines — *and* the "US" team color locked in permanent opposition to `#ff453a` "THEM" (`styles.css:11–12`). A color that means everything brands nothing; and every red element (Del, LOSS, Sign Out, Goals Against) reads as "danger + opponent" at once.
2. **287 distinct color literals vs 15 tokens.** 155 hex + 132 rgba in `styles.css` alone; **four unrelated greens all meaning "good"** (`--good` #32d74b, Material #4caf50 in the LIVE badge/sparklines, `--comp-good` #5ee07a, a six-member spectator pastel family); ≥7 blues; ~50 one-off near-blacks bypassing the `--gray-*` ramp that already exists (`styles.css:20–29`). The palette is an accretion, not a decision — nothing repeats often enough to become recognizable.
3. **One font, one voice, no numeral craft.** System stack at 700/800 for headline, label, and data alike; **21 distinct font sizes**; `tabular-nums` exists in exactly 5 rules — all spectator (`styles.css:2795+`). The coach-side scores, rings, tiles and tables — a numbers product — render proportional figures, and the nonstandard weights 780/820/910 silently degrade off Apple devices.
4. **Uniform elevation.** Every surface is the same recipe — near-black fill, 1px white-alpha hairline, rounded corner — nested 3–4 deep (modal → section card → stat tile). 16 literal radii coexist with 7 defined tokens; ~35 shadow recipes with no elevation scale. Hierarchy is carried entirely by font size: the "generic dark dashboard" look, by construction.
5. **Iconography is four systems at once**: clean stroke-SVGs (hamburger, calendar, chevron, undo — already Lucide-compatible), color emoji (landing features, one broken), text glyphs (● ✓ ▲ ▼), and a raw 🎩 for the hat-trick moment — sometimes mixed in a single list (`index.html:1512–1515`).
6. **The identity lives on the wrong surface.** The spectator view — Avenir Next, coherent steel-blue surface ramp, tabular numerals, celebration system — is the only surface with a personality, and it's the free one. The coach app that will carry the price tag shares almost none of it.
7. **The product never celebrates itself or the user.** No mark, no wordmark treatment (the header is plain 17px system text), no app icon, and the flagship post-game screen ends on a red Delete Game button. The coach-side goal moment is a 0.6s alpha flash. Compare §7: Strava's PR trophies, share cards, and Year in Sport are a *system*, and it's their marketing engine.

**What good looks like here** (full spec sketch was produced and is summarized in §5): a 4-step blue-cast surface ramp replacing all one-off darks; ONE brand accent separated from the THEM/US pair (keep ice-blue but split brand-blue from us-blue by saturation, or go warm à la GameChanger — Jamie's call); one green/amber/red semantic trio with alpha tints; a 9-step type scale with `tabular-nums` everywhere numbers appear and one display face for wordmark/titles/score digits; radius tokens only (8/12/16/999); a 3-level shadow scale; the existing stroke-SVG icon language extended to every icon slot; motion tokens (120/240/400ms) plus one coach-side goal celebration and a post-game "final" moment. The spectator language should be promoted app-wide, not left stranded.

---

## 4. Prioritized Recommendations

Impact: effect on monetization-readiness. Effort: H/M/L. **Claude** = buildable by Claude Code alone.

### Tier 1 — Hardening sprint (before anything else)

| Issue | Proposed change | Rationale | Impact | Effort | Claude? |
|---|---|---|---|---|---|
| Goal For lost on backdrop/cancel/reload | Commit the goal immediately on tap (scorer `?`, enrich after); toast + undo on any chain abort; add Cancel to GA context; make backdrop = "Tag Later", not discard | Silent score loss is the worst possible data event | H | M | Y |
| SV% 1.000 → `.000` (~10 call sites) | Shared `fmtSvPct()` (port `js/spectator.js:654–658`); standardize `.917` format everywhere incl. season "91.2%" | Best games show worst number; 3-decimal is the hockey convention | H | L | Y |
| Guest cold-load hits marketing page mid-game | Persist a guest flag; skip landing/auth when set and state exists | Rink-WiFi reload currently looks like total data loss | H | L | Y |
| Live-game wipe race (observed once) | Init-gate: `save()` refuses to overwrite a stored live game before `load()` resolves (`js/app.js:3423`, `3918`) | Unrecoverable data loss, however rare | H | M | Y |
| "No Assist" never appears | Remove `hidden` class from `#pickerNone` (`index.html:1078`); toggle via classList | One line; unassisted ≠ unknown in the data coaches pay for | H | L | Y |
| Sticky status toasts | Add `.show` synchronously (or token-guard the rAF) in `showStatusToast` (`js/app.js:771–781`) | Affects every toast; verified stuck >5 min over UI | M | L | Y |
| End Season modal behind Manage Teams | Close `teamModal` before opening, or raise z-index | Flow is currently dead to touch users | H | L | Y |
| PWA icons missing | Generate placeholder 192/512/maskable + favicon now; swap for branded set later; fix `theme_color` | Broken install = broken "app" | H | L | Y (placeholder) |
| save-game trusts client `user_id` | Ignore client uid when no token (anonymous rows stay null) — `api/save-game/index.js:47`, `api/games/index.js:22,34` | Data-integrity hole before paid accounts | H | M | Y |
| End Game & Score: no confirm, buried | Confirm with period+score; surface in header from P3 on | Irreversible auto-save on a single unguarded tap | M | L | Y |

### Tier 2 — Design system & brand (gated on §6 decisions)

| Issue | Proposed change | Rationale | Impact | Effort | Claude? |
|---|---|---|---|---|---|
| 287 color literals / 4 greens / brand=data | Token migration to surface ramp + 1 accent + semantic trio (spec in §3/§5) | The core anodyne mechanic | H | M | Y (after palette sign-off) |
| No numeral treatment; 21 font sizes | `tabular-nums` on all numeric classes; collapse to 9-step scale; weights 400/600/700/800 | Numbers product, number craft | H | L–M | Y |
| Icon chaos incl. broken glyph | Extend existing stroke-SVG set to all slots; kill emoji; fix `index.html:458` now | Highest polish-per-hour available (benchmark: zero emoji among paid comparables) | H | L–M | Y |
| Radius/shadow/spacing entropy | Enforce tokens (8/12/16/999; 3 shadows; 4px grid) | Cheap coherence | M | M | Y |
| Spectator language stranded | Promote its ramp/numerals/celebration app-wide | The product's best design already exists | H | M–H | Y |
| No brand moment; summary ends on Delete | Wordmark lockup slot; move Delete to overflow; add goal celebration + post-game "final" moment; share card | Perceived value; Strava pattern | H | M | Partial (assets: Jamie) |
| Desktop landing is a phone column | 2-col hero ≥900px | Parents open share links on laptops | M | M | Y |

### Tier 3 — Rink-side UX polish

| Issue | Proposed change | Rationale | Impact | Effort | Claude? |
|---|---|---|---|---|---|
| Period chips 26×23, Switch 57×21 | 44px hit areas; period change gets Next-Period-style intent | Silent event re-bucketing from glove taps | M | L | Y |
| Grid shifts ~85px on first event | Fixed-height Chance Quality slot from start | Targets must not move mid-game | M | L | Y |
| Undo confirms nothing, never saves | "Undid: X" toast + Restore; add `save()` in `undo()` | Blind multi-event destruction | M | L | Y |
| No last-event feedback | One-line ticker under goalie chip ("✓ Shot For — #7") | Glance-confirmation without 9px text | M | M | Y |
| Panels open below the fold, no state | scrollIntoView + pill active state; consider accordion | Users can't find what they opened | M | L | Y |
| No back-button/routing | Minimal popstate layer (modal/panel close first) | Android back exits the PWA | M | M | Y |
| Setup empty-state says the same thing 4× | Keep chip + card; drop the two hint lines | Uncertainty smell (ROADMAP 2A spirit) | L | L | Y |
| Switch-goalie: confirm-then-pick, red | Picker first, no confirm (per GOALIE_PLAN locked copy) | Routine action, alarm styling | L | L | Y |
| Guest "Cloud sync: Synced" | "Local + anonymous backup" or hide row; gate End Season for guests | Contradiction at the upsell site | M | L | Y |

### Tier 4 — Model & domain credibility

| Issue | Proposed change | Rationale | Impact | Effort | Claude? |
|---|---|---|---|---|---|
| xG contradicts goalie model at youth levels | Derive `XG_RATES` from `LEVEL_PROFILES` per level, or relabel as "Chance Quality" index | Internal contradiction analytics parents will catch | H | L–M | Y |
| Dampening over-protects disasters; shutouts cap at 89 | Re-run SCORING_ROADMAP 4A harness; tighter negative spread; small shutout bonus (GA=0, SA≥20); fix stale comment `js/app.js:1908` | The two "app is broken" score complaints | M | M | Y |
| Dampening disclosed only <10 shots | Show "Only X shots — pulled toward average until 20+" whenever confidence < 1 (PRE 1D as spec'd) | #1 predicted support complaint | M | L | Y |
| PP/PK inconsistency; no "approx." note | `pkOpps = max(penaltiesAgainst, ppGA)` (mirror for PP); render the scoped footnote | Same-screen self-contradiction | M | L | Y |
| +/- counts PP goals-for | Exclude PP GF (`js/app.js:1731–1742`) | Hockey convention | L | L | Y |
| Terminology drift (PRE 3C partial) | One pass to canon: full form vs compact ("Odd-Man Rush"/"OMR", "Pen Drawn/Taken" replaces ambiguous "Pen For/Ag", "DZ TO") | Same-grid mixing reads sloppy | M | L | Y |
| Landing says "objective" | "Consistent, context-aware scoring" | Honesty = durable trust | L | L | Y |
| Spectator: team unnamed; verdict from 1 shot | Team name in share payload + headline; sample guard on `renderQuality` | The growth-loop surface headlines the wrong team | H | M | Y |
| Spectator 375px overflow; ended-vs-waiting states; "just joined" card (only unbuilt spectator item) | Fix `css/styles.css:2722`; distinct ENDED state; build ROADMAP 3B | Parents' first impression | M | L–M | Y |

### Tier 5 — Monetization infrastructure (own workstream, after tiers 1–2)

Pricing model + paywall (PRE 7C), upgrade-prompt moments, payment provider, subscription state, per-goalie score (explicitly deferred), Reset-Season placement, accessibility pass (roles/dialogs/focus), dev-artifact removal, og-image name fix.

---

## 5. What Claude Code Can Do Unassisted

Everything in Tier 1, 3, and 4 above, plus from Tier 2:

1. **Design-token migration** — surface ramp (`--surface-0..3`, single `--line` hairline), semantic trio with alpha tints, mechanical replacement of the 287 literals (~20 tokens end-state); ready to execute the moment the accent decision lands.
2. **Type system** — 9-step scale (11/12/13/15/17/20/24/32/44), weights 400/600/700/800, global `tabular-nums` on numeric classes, removal of 780/820/910.
3. **SVG icon set** — extend the app's existing stroke-2 language (Lucide-compatible) across landing features, welcome list, feed arrows, hat-trick trophy; delete all emoji.
4. **Radius/spacing/shadow normalization** — tokens only: 8/12/16/999; 4px grid; 3 shadows + focus ring.
5. **Motion system** — easing/duration tokens; coach-side goal celebration (score-digit bump + accent ring pulse); post-game "final" beat; keep the good ones (goal-flash, skeleton shimmer, hat-trick pop, spectator score-bump).
6. **Spectator-language unification** app-wide; desktop landing layout; empty-state copy pass; PRE 4I inline-style extraction; placeholder app icons; `theme_color`; og-SVG name fix; all data-integrity and API fixes.

## 6. What Requires Jamie's Input or External Assets

1. **Logo / mark + wordmark lockup.** AI can produce candidates, but a mark that must survive at 16px favicon, 512px app icon, share cards and the header needs a deliberate selection round with the owner — it is *the* brand decision, and every asset below derives from it.
2. **Accent decision.** Two defensible directions: stay ice-blue (split brand-blue from us-blue by saturation — Hudl/Strava single-accent norm) or go warm orange (GameChanger/TeamSnap pattern, maximally distinct from both team colors). This choice defines the product's temperature; it's a taste call only the owner should make, then Claude executes the migration.
3. **App icon set (192/512/maskable) + favicon** — derived from the mark. Claude can ship placeholders now (and should, to unbreak install), but store-quality icons need the real mark.
4. **Display typeface.** Free option (e.g., Barlow Semi Condensed) Claude can wire immediately; anything licensed (the spectator's Avenir Next look currently exists only on Apple devices) is a purchase decision.
5. **Landing imagery.** The desktop landing can't carry itself on UI mockups alone — real rink/bench photography or commissioned illustration; AI-generated imagery of children at a rink is both quality- and taste-risky for a youth-sports product.
6. **Palette sign-off before the 287→20 migration executes** — it touches every screen; a one-page before/after review is cheap insurance.
7. **Monetization model decisions** (informed by §7): who pays (benchmark evidence says parent-side ceiling is higher), what gates (benchmark: gate score *history/depth* and season recaps, never live scoring or the share link — the link is the growth loop), price point ($30–60/yr parent-side or $60–100/yr coach-side sits inside the 2026 comparable band), and payment rail (PWA = no store cut; GameChanger and CoachNow both deliberately sell web-only).
8. **Production security verification** — the `save-game` fix is code, but confirming Supabase/Firebase production config (RLS posture, token verification on the deployed environment) needs Jamie's project access.

## 7. Competitive Benchmark Notes

Researched July 2026: GameChanger, TeamSnap, Hudl, CoachNow, Strava (full briefs and sources in the research appendix below the table).

| App | Identity | What it proves for STT |
|---|---|---|
| **GameChanger** | Dark UI + warm accent; "broadcast graphics for your kid" | Closest comparable. Scoring is **free forever** (acquisition wedge); **parents pay** — $14.99/mo or $99.99/yr, Family $179.99/yr — for streaming/archive/advanced stats. Spectator devices worth porting: scoreboard overlay, *animated play-by-play that needs no video*, event push alerts, lock-screen live score. Sells family plans web-only to dodge the store cut — a PWA's home advantage. |
| **TeamSnap** | Orange, jersey-type warmth, lifestyle photography | Coach-pays admin model ($15.99–21.99/mo per team). Gates the weekly-pain feature (availability/RSVP) — masterclass in choosing the gate. Their stats are widely considered shallow: "the stats app that's actually good" is open space. |
| **Hudl** | #FF6300 on near-black slate; tokenized "Uniform" design system | The visual lane STT should own — disciplined single accent on layered dark neutrals — executed with tokens, which is exactly what STT lacks. Sells *trust in numbers* as a service (Assist). Org pricing ($400–1,600/team/yr) irrelevant to a solo-coach PWA. |
| **CoachNow** | Black/white minimalism, feature-rich | The cautionary tale: features without visual identity still reads anodyne. Tiering by identity (parent/coach/facility) is smart; $59/yr entry anchor. |
| **Strava** | #FC5200 single accent; Boathouse display face for brand + Inter for data; "Spandex" design system | **The playbook for a proprietary 0–100 score**: show it as a trend not a bare number; publish a plain-language methodology (they name the PhD behind Fitness & Freshness); be explicit about input sensitivity; make it shareable (PR trophies, share cards, Year in Sport — which became a *paid perk* in Dec 2025). Analytics layer is precisely the paywall ($79.99/yr); recording stays free. |

**Cross-cutting implications for Smart Team Tracker:**
- One saturated accent on stepped neutrals, never pure black, never two brand hues — every paid comparable follows this; STT currently violates all three clauses.
- The parent is the payer in the closest comparable; STT's spectator link is currently a free feature but is actually the monetizable asset — and it's also the growth loop, so gate *depth* (history, recaps, per-goalie season analytics), never the live link itself.
- Trust-dress the 0–100 scores Strava-style: the "How is this scored?" expanders already built are the right start; add score trend-first presentation, a public methodology page, and honest input-sensitivity language (the dampening disclosure in Tier 4 doubles as this).
- Celebration as a system (share cards, milestones, "Season in Review" as the flagship premium feature) is the emotional layer STT entirely lacks and the benchmark apps monetize directly.
- Emoji iconography has zero precedent among paid comparables; price anchors for 2026: $59–180/yr depending on side of the rink glass.

---

## Appendix A — Roadmap implementation scorecard

Verified this session (✔ = implemented as scoped): ROADMAP: 1A ✔ · 1B ✔ (SV% format bug) · 1C ✔ · 2B–2G ✔ · 3A ✔ · 3C ✔ · 4A–4D ✔ (4C partial: insight text not truncated) · **3B ✘ not built**. PRE_MONETIZATION: 1A ✔ (note <10 not <20) · 1B ✔ · 1C ✔ · 1D partial · 1E ✔ · 2A partial (anonymous user_id hole) · 2B ✔ · 2C ✔ · 2D ✔ · 3A ✔ (og-svg missed) · 3B ✔ · 3C partial · 3D ✔ · **4B ✘ not built (roster textareas)** · 4I ✘ open · 4J ✔ · 6C ✔ (coach-mark overlap bug) · 6D ✔ · 7A ✔ · 7B ✔ (code-verified) · **7C ✘ not started (expected)** · 8D ✔ · 8E ✔. STATS_UX: 1A/1B ✔ · 2A ✔ (no approx. note) · 2B ✔ (Danger advice mismatch) · 2C ✔ · 2D ✔ · 3A–3F ✔ (**3E goalie-change note ✘**) · 4A ✔ (no per-goalie W-L) · 5A/5B ✔ · 6A ✔ · 6B ✔. SCORING_ROADMAP: implemented, 17/20 constants exact (deviations documented in §2.7). GOALIE_PLAN/GOALIE_DEPTH: ✔ (switch-confirm order deviates from locked copy). OPPONENT_RECORDS: ✔ with locked copy exact. END_SEASON: ✔ (modal stacking bug). TEAM_SYNC: ✔ code-level (not end-to-end testable in guest mode).

## Appendix B — Audit trail & known limitations

- All interaction was in guest mode at 375×812 (plus 1280×800 for the landing); Firebase sign-in, cloud sync end-to-end, and production Supabase behavior were code-verified only (no accounts created per audit policy).
- One finding (live-game wipe) was observed once and did not reproduce in three controlled attempts; treated as a race hypothesis with a defensive fix, not a confirmed defect.
- The spectator "ended vs waiting" behavior should be re-verified against production Supabase; the local dev server's response shape may differ.
- Seed data left behind: browser localStorage contains team "Audit Wolves" and two saved guest games plus two test opponent names ("UX Test", "NapUX Test" — removable via the opponent dropdown ×). The repo working tree was left untouched (verified `git status` clean); the only file added is this report.
- A click-coordinate scaling quirk of the audit browser harness required calibration during testing; it is an artifact of the audit tooling, not an app defect, and no finding depends on it.
