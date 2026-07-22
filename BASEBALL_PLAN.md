# Baseball Module: Design Doc

Status: Draft (planning). Last updated 2026-07-21.
Owner: Jamie. Build lead notes written for a novice developer, so terms are explained the first time they appear.

This is a plan, not code. It describes a digital scorebook for kid-pitch youth baseball that we can build, put online at its own URL, and hand to friends to test. Once it earns its keep, we decide how to fold it into Smart Team Tracker.

---

## 1. What we are building, in one paragraph

A phone-first, offline-capable app that replaces the paper baseball scorebook. The scorekeeper taps the actual kids on a diamond graphic and on the base paths, and the app writes the correct baseball notation, keeps the live score, and rolls everything up into real batting, pitching, and fielding stats. It tracks the coach's own team fully, tracks the opposing team's batting for future scouting, and never stores a single player name.

---

## 2. Design principles (the rules we do not break)

1. **Numbers, never names.** Every player, on both teams, is identified only by jersey number (plus, optionally, a fielding position). No first names, last names, or nicknames are stored anywhere. This is a privacy promise and a selling point for youth sport.
2. **Offline-first, privacy by omission.** Scoring works at the field with no signal (localStorage is the instant read layer), and syncs to the cloud when back online, reusing the pattern the hockey app already uses. Privacy comes from storing only jersey numbers, never names, so even the synced data holds no personal information. Data is scoped per user and never shared between accounts.
3. **Paper parity before cleverness.** v1 must let one person score a full real game start to finish and never reach for paper. Fancy analytics come after.
4. **Real stats, not invented scores.** We ship standard baseball stats (batting average, ERA, fielding percentage). We do NOT ship a made-up "player score" at launch. Credibility first. An optional synthesized grade can come much later.
5. **One-handed and forgiving.** Coaches score while managing a dugout. Big taps, and an undo that is bulletproof.
6. **Standalone front-end, shared backend.** Build the baseball screens as a separate entry point with its own URL for friend testing, but run it on the existing backend (Firebase auth, Supabase, the API endpoints) rather than a new architecture. "Standalone" means a separate front door, not a from-scratch stack. A "select your sport" picker is that front door, and it is the same pattern we later fold into the main app.
7. **One product, two sports.** Baseball inherits the hockey app's visual system so the two feel like one family. We re-skin the sport accent, not the design language.

---

## 3. Architecture and deployment

Smart Team Tracker already runs on Firebase auth, a Supabase Postgres database, and a clean serverless API, and that stack absorbs a second sport with almost no change. Baseball reuses it. The only genuinely new code is the baseball front-end.

### 3.1 What already exists, and how we reuse it

| Existing asset | What it does today | Reuse for baseball |
|---|---|---|
| Firebase auth (`js/auth.js`, `api/_auth.js`) | Sign-in plus server-side token verification, with a guest mode (uid may be null) | As-is. Testers sign in with Google or use guest mode. |
| Supabase `games` table | Stores each game as a few query columns plus a **JSONB `data` column that holds the entire game object, with no schema and no allowlist** (the code comment: store ALL stats, no schema changes needed) | As-is. A baseball game is just a `data` blob carrying `sport: 'baseball'` and its event log. **No migration is needed to store baseball games.** |
| Supabase `teams` table | Team plus roster; roster entries are already free-text strings | Add one `sport` column (default `hockey`) so the app knows which engine to load. Roster holds jersey numbers. |
| Supabase `opponents` table | Per-team opponent list, auto-updated on every save, tracks `last_played_at` | The anchor for opponent scouting history. Already built. |
| `/api/save-game`, `/api/games` | Save and list games, with auth and rate limiting | As-is. They already accept and return an arbitrary game shape. |
| `/api/teams`, `/api/opponents` | CRUD with auth and rate limiting | As-is, with a minor extension for the `sport` field and opponent detail. |
| `js/teams.js` sync pattern | localStorage for instant offline reads, Supabase for cross-device persistence | Copy this pattern for offline-at-the-field scoring. |
| Rate limiting (`api/_rate-limit.js`), `/api/ping` | Abuse protection and a live connectivity indicator | As-is. |

The headline is the `games.data` JSONB column: because it stores whole game objects with no fixed schema, the backend can already persist a baseball game today. That single design choice is why adding a sport is cheap.

### 3.2 What is genuinely new (the actual work)

- The **baseball front-end**: the live-scoring screen (diamond-tap defense, base-path offense, outcome pad, count, outs, innings, undo).
- The **baseball event model and stat math**: the event log format, plus batting, pitching, and fielding calculations.
- The **box score and season rollups** for baseball.
- A **sport picker** entry point.
- One schema change: a `sport` column on `teams` (and optionally hoisting `sport` to a top-level `games` column so we can query by sport later, mirroring how `level` and `opponent` are already hoisted).

### 3.3 Deployment shape

- **Stack:** same as the main app. Vanilla HTML, CSS, JavaScript. Installable PWA so it works offline at the field and adds to the home screen.
- **Where it lives:** a separate front-end entry point (its own page or route) in this repo, sharing the existing `/api` and Supabase project. It can be given its own URL for testers. It reuses the backend rather than duplicating it.
- **Front door:** the app opens on a **sport picker**. Baseball is live; hockey and any future sport are placeholders for now. This is the toggle we later move into the main shell.
- **Look and feel:** carry the Smart Team Tracker brand, the bold chrome style, not flat minimalism. See section 7.

Because the backend is shared from the start, the deferred integration work is purely front-end: folding the sport picker and baseball screens into the main `index.html`, and deciding what UI is shared (rosters, seasons, spectator) versus sport-specific. No backend rebuild, no data migration.

---

## 4. The scoring model, explained for a novice

### 4.1 Position numbers (the secret language of a scorebook)

Every defensive position has a permanent number. These never change during a game.

| # | Position | # | Position |
|---|----------|---|----------|
| 1 | Pitcher | 6 | Shortstop |
| 2 | Catcher | 7 | Left field |
| 3 | First base | 8 | Center field |
| 4 | Second base | 9 | Right field |
| 5 | Third base |   |   |

A "6-4-3 double play" means shortstop (6) threw to second baseman (4) who threw to first baseman (3). These are **position** numbers, not jersey numbers.

**The key trick that powers the whole app:** the scorekeeper taps the actual kid on the diamond. The app already knows that kid's position from the lineup, so it writes the position number for you. You never learn the numbers. The app is fluent so you do not have to be.

### 4.2 How a plate appearance ends (the outcomes you tap)

A batter comes up, the count runs (balls and strikes), and the appearance ends in exactly one outcome. Group them in the UI like this:

**Reached base**
- Single, Double, Triple, Home run
- Walk, Intentional walk, Hit by pitch
- Reached on error (records which fielder booted it, for example E6)
- Fielder's choice, Dropped third strike (batter reaches first)

**Made an out**
- Strikeout (swinging or looking)
- Groundout (tap the fielders: 6-3, 4-3, 5-3, or 3U for unassisted)
- Flyout, Popout, Lineout (tap where it went: F7, P4, L8)
- Force out, Double play, Triple play
- Sacrifice fly, Sacrifice bunt

**Then the runners move** (a separate step): stolen base, caught stealing, wild pitch, passed ball, advanced on the hit, out at a base, scored. This is the runner path you would draw on paper.

So a full plate appearance recorded in the app equals: **outcome + where the ball went (fielder taps) + what every runner did.** That is one cell of a paper scorebook.

### 4.3 Game flow state

At any moment the game has: inning number, half (top or bottom), outs (0 to 3), count (balls and strikes), which bases are occupied and by which jersey number, the current batter for each team, and the score. Every event updates this state.

### 4.4 Event-sourced log (why undo will be rock solid)

We store the game as an ordered **list of events** (pitch, plate appearance, baserunning event, substitution). The live scoreboard is calculated by replaying the list. Undo simply removes the last event and recalculates. This gives us a perfect undo and a complete, replayable history for free, which matters because one mis-tap otherwise corrupts outs, count, and runners.

---

## 5. Tracking both teams (and the opponent question, settled)

In any half-inning, one team bats and the other fields. Those are the same events seen from two sides: your kid's catch is your fielder's putout and the opposing batter's out.

We log **every plate appearance for both teams**, because that is the only way to keep a complete book and an accurate score. The difference is what each side feeds:

| Quadrant | Tracked? | What we do |
|---|---|---|
| Your team batting | Yes, full | Full batting stats per jersey number |
| Your team fielding | Yes, full | Putouts, assists, errors from diamond taps, plus pitching |
| Opponent batting | Yes, and **kept for scouting** | Log each plate appearance by opponent jersey number, including where the ball went. Persist across games so tendencies build up. |
| Opponent fielding | No | Only note where the ball went on your batter's out (for example "grounded out to short"). Never credit named opponent fielders, never compute their fielding stats. |

The same plate-appearance entry screen is used no matter who is batting. When your team is in the field, logging the opposing batter's result **also** credits your fielders (because they made the play). When your team bats, we log your batter's result and only note the position the ball went to, with no credit to the opposing fielders.

---

## 6. The diamond-tap interface

Two distinct tap surfaces. Keeping them separate is what makes it usable one-handed.

### 6.1 The field surface (defense)

- A diamond with all 9 positions drawn, each showing the kid currently there (jersey number, optionally the position label).
- On a ball in play, tap the fielders in the order they touched the ball. The app converts taps to notation (6-4-3) and infers the play type from game state (runner on first plus two taps ending at second then first equals a double play).
- Putouts and assists are credited to the right kids automatically.
- Tapping roughly where the ball landed also captures a **location** (spray data), which later becomes spray charts for both your hitters and opponent scouting, at no extra effort for the scorekeeper.

### 6.2 The base-path surface (offense)

- The four corners of the diamond act as the runner track.
- Tap or drag each runner to where they ended up: safe at second, out at third, scored. This logs advancement, steals, and who is left on base.

### 6.3 Undo

- A large, always-visible "undo last" control. Because the game is an event log, undo is exact and safe. This is a first-class feature, not an afterthought.

---

## 7. Visual language and interaction

The hockey app already ships a mature dark design system: named design tokens, two athletic fonts, a two-team color language, a scoreboard, stat tiles, jersey-chip rosters, and tactile press feedback on every control. Baseball inherits that system whole and retunes only the sport accent. Structure does not change. Most of the CSS is reuse, which is why baseball can look finished quickly.

### 7.1 The theme it inherits (keep as-is)

- **Dark canvas, one theme.** Page surface is near-black (`#05070C`), layered up through a four-step surface ramp to `#1D2733` for pressed and hover states. High contrast, staged like a game under the lights. Hockey reads as a rink at night; baseball reads as a night game under stadium lights. The same dark stage carries the mood across both.
- **Two-team color language.** Your team is blue (`--us #2F6FED`), the opponent is red (`--them #DB3B4B`). This runs through the scoreboard, zone tints, and stat accents. It maps one to one onto home and away, so keep it exactly.
- **Constant semantic colors.** Win green (`--win #1FB880`) and warn amber (`--warn-ice #F4A627`) mean the same thing in every sport. Do not repaint them. Shared meaning is an asset.
- **Typography.** Saira Semi Condensed (condensed, athletic) for scores, big numbers, and headers. Hanken Grotesk for UI text, labels, and stats. Both are already bundled in the repo. The condensed display face is the bold, not-flat brand feel Jamie wants, so reuse it. No new typeface is needed.
- **Shape, elevation, motion.** Radius tokens 8 / 12 / 16 / 22 / 999, three shadow levels, a teal focus ring, and the shared easing curve `cubic-bezier(.22, 1, .36, 1)` at 120 / 240 / 400ms. Reuse verbatim.

### 7.2 What re-skins for baseball (the sport accent)

The only palette change is the brand accent. Hockey's signature is ice teal (`--ice #17B6C8`), used for primary buttons and active states. Baseball needs its own signature that does not collide with the four constants above (blue us, red them, green win, amber warn).

- **Recommendation: an infield-clay accent**, a warm burnt-orange in the `#D9772E` family, evoking dirt and baseball leather. It is warm where the team blue is cool, and more orange and saturated than both the amber warn and the red opponent, so it stays distinct at a glance. Exact hex tuned for contrast in the asset phase.
- This accent drives primary CTAs (the start-game gradient), active and selected states, and brand moments. Everything else keeps the existing tokens.
- The diamond graphic carries its own green turf and tan dirt, kept inside that component so those field colors do not compete with the accent elsewhere.
- **Background:** reuse the hockey technique, a soft radial aurora of team colors bleeding over the dark page. Swap the ice-tint glow for a subtle field-green and clay glow.

### 7.3 Components that transfer directly (reuse, do not rebuild)

| Hockey component | Reuse for baseball |
|---|---|
| Scoreboard row (`.scoreboard-row`, `.scoreboard-team.us` / `.them`, `.score-val`, `.score-sub`) | The live score header. Big run totals per side, with `.score-sub` showing hits. Add a compact situation cluster: bases occupied, outs, and the ball-strike count. |
| Segmented period selector (`.period-seg`) | The inning selector: innings 1 to N with a top and bottom half. Same segmented control. |
| KPI tiles (`.dashTile` with key / value / sub) | Batting, pitching, and fielding stat tiles (AVG, H, R, RBI, ERA, pitch count). |
| Roster jersey chips (`.roster-entry`, `.roster-number`, setup chips) | The numbers-only roster. Baseball is number-first, so this fits as-is. |
| Buttons (`.btn-start`, `.btn-start-secondary`, `.btn-icon`, `.toolbar-btn`) | The same button system, with the primary gradient recolored to the clay accent. |
| Status pills (`.pill.good` / `.warn` / `.bad`) | Pitch-count warning, run-cap reached, and similar flags. |
| Toasts, modals, app header | Reused verbatim. |
| Score-change flash and celebration animation | The run-scored flash and the inning-change transition, using the same motion. |

### 7.4 The one net-new component: the diamond

No hockey equivalent exists, so it is designed fresh but in the same visual language.

- A baseball diamond drawn as SVG on the dark field. Nine fielder nodes, each styled like a roster jersey-chip pinned to its position, showing the kid's number. Tapping a node uses the same press-scale, optional haptic, and accent glow as the rest of the app.
- As taps land, a "6-4-3" ribbon assembles at the top of the surface in the Saira display face, so the scorekeeper watches the notation form.
- The four base corners are runner tokens on the base-path surface. Tap or drag a runner token to its ending base. Scoring a run fires the run-scored flash.
- Everything is theme-driven, with turf, dirt, and chalk as CSS variables, so the same diamond can be recolored or re-themed later without redrawing it.

### 7.5 Field-use and accessibility guardrails

- **Thumb-first layout.** Primary actions (the outcome pad and undo) sit in the lower half of the screen, with the diamond above. Reuse the existing 44px minimum hit areas.
- **Fewest taps per event**, and undo always one tap away.
- **Daylight glare.** The dark theme is excellent at night but can wash out in bright sun. A high-contrast day variant is a known future need, since the app is dark-only today. Flag it now, do not build it in v1.
- **Native feel.** Keep the transparent tap highlight and the press-scale feedback on every control so it never feels like a web form.
- **Colorblind safety.** Never lean on the blue and red team pair alone. Always pair color with a label (US / OPP) or a position, the way the scoreboard already does.

---

## 8. Requested assets (provide in a later phase)

None of these block the build. The front-end can scaffold with placeholders plus the existing tokens and fonts, and we swap real art in when we polish. Fonts are already in the repo (Saira Semi Condensed, Hanken Grotesk), so no new typeface is requested.

1. **Baseball wordmark / logo lockup** in the Smart Team Tracker chrome style, light and dark, matching the existing hockey lockups in `assets/brand/`.
2. **Sport-picker tile art**: a baseball mark and a hockey mark in the same chrome style, for the front door.
3. **Diamond field base graphic (SVG)**: field outline, base bags, foul lines, pitcher's mound, and turf and dirt zones, built with CSS-variable fills so it stays themeable.
4. **Field background texture** (turf plus infield dirt) as webp bands, dark variant required, analogous to the ice-texture bands in `assets/brand/`.
5. **App identity icons** for the baseball entry point: favicon, 192 and 512 PNGs, maskable 512, and apple-touch-icon, or a decision to reuse a single unified Smart Team Tracker icon.
6. **Fielder-node and base-token styling reference**: a short spec that extends the existing jersey-chip, not new art.
7. **Baseball share-card background and og:image** (1200 x 630), matching `assets/share/`, for the deferred sharing phase.
8. **Empty-state spot illustrations**: "no games yet" and "no opponents yet," in the brand style.
9. **Optional sound and haptic cue spec** for run-scored and pitch-count-warning. Behavioral, not a visual asset.

---

## 9. Screens and navigation

1. **Sport picker** (front door): choose Baseball. Others shown as coming soon.
2. **Teams:** create your team (team name plus a roster of jersey numbers). Create or pick an opponent (team name plus numbers, which can also be added on the fly during a game as new numbers appear).
3. **Game setup:** home or away, level (kid-pitch selected), innings, run-per-inning cap if the league uses one, starting lineup and field positions, starting pitcher.
4. **Live game (the heart):** scoreboard (inning, outs, count, score, bases), the diamond and base-path surfaces, the plate-appearance outcome pad, pitch count, and undo.
5. **Box score:** per-game batting, pitching, and fielding lines for your team, plus the opponent batting line.
6. **History and scouting:** season totals for your team, and per-opponent scouting built from every game you have logged against them.
7. **Settings:** level and rule config (pitch limits, run caps, innings), data export and wipe.

---

## 10. Stats catalog

### 10.1 Batting (per jersey number, per game and season)
Plate appearances, at bats, hits split into singles, doubles, triples, home runs, runs, runs batted in, walks, strikeouts, hit by pitch, stolen bases, caught stealing. Derived: batting average, on-base percentage, slugging, OPS.

Youth-friendly main view surfaces the four that parents understand: **Hits, Runs, RBI, On-base percentage.** Everything else lives one tap deeper.

### 10.2 Pitching (headline feature for youth)
Innings pitched, **pitch count**, strikes and balls, batters faced, hits allowed, runs, earned runs, walks, strikeouts. Derived: ERA, WHIP.

**Pitch count is the single most valuable youth feature.** Leagues cap pitches by age and require rest days between outings, for arm safety. A live counter that warns as a kid nears the limit, plus a rest-day log, replaces the scraps of paper coaches use today. See section 11.

### 10.3 Fielding (falls out of the diamond taps)
Putouts, assists, errors. Derived: fielding percentage.

---

## 11. Kid-pitch rules layer

Level is a setting because rules change which events are even possible. v1 anchors on kid-pitch (roughly ages 9 to 12). Tee-ball and coach-pitch become simplified modes later.

- **Pitch limits and rest.** Track pitches live per pitcher and warn as a configurable limit approaches. Rest requirements between outings depend on how many pitches were thrown. **These numbers vary by league (Little League, PONY, Baseball Canada, and local associations all differ), so they must be editable settings with sensible defaults, and we will confirm the exact numbers against Jamie's league rather than hardcoding them.**
- **Continuous batting order.** Most youth leagues bat the entire roster, not nine. The lineup may be 10 to 15 kids. The engine must not assume nine slots.
- **Free substitution and re-entry.** Kids rotate constantly and the diamond positions change mid-game. Substitutions are logged events so the field map and playing-time report stay correct.
- **Run cap / mercy rule.** Many leagues cap runs per half-inning (for example 5, then switch sides). Configurable, and the app flags when the cap is hit.
- **Playing-time and fairness report.** Leagues often mandate minimum innings or plate appearances per kid. A post-game report of each number's innings in the field and plate appearances helps coaches stay compliant and answer the "why did my kid sit" question. Quiet killer feature.

---

## 12. Opponent scouting (why we keep opponent batting)

This is where the existing `opponents` table pays off. It already keys opponents per team and updates on every save, so we hang batting history off records we are already creating. Because opponent batters are logged by jersey number and retained across every game against that team, the app builds a scouting view over time, with no names attached.

Per opponent team, and per opponent number:
- Spray chart of where they hit the ball (pull, opposite field, infield versus outfield).
- Tendencies: ground ball versus fly ball, strikeout rate, how often they put the ball in play.
- Simple hot notes the app can surface, for example "their number 7 pulls almost everything to left."

Your own hitters get the same spray benefit from the same data. This is the payoff for the small extra effort of logging opponent plate appearances, which you are largely doing anyway while your team fields.

---

## 13. Scope: what is in v1 versus later

**In v1 (paper-parity MVP, kid-pitch, numbers only):**
- Sport picker front door.
- Team and roster setup by number, opponent setup by number, reusing the existing teams and opponents endpoints.
- Live game: scoreboard, diamond-tap defense, base-path offense, full plate-appearance outcomes, count, outs, innings, run cap, live score, bulletproof undo.
- Pitch count with limit warning.
- Box score and season batting, pitching, fielding.
- Save offline to localStorage, sync to Supabase through the existing `/api/save-game` when online, so a tester never loses a game and can pick up on another device.
- The visual system from section 7, re-skinned to the baseball accent.

**Deferred (after testers validate the core):**
- Opponent scouting views and spray charts (the data is captured in v1, the visualizations come later).
- Playing-time and fairness report.
- Tee-ball and coach-pitch modes.
- Spectator follow-along and share cards.
- Any synthesized player grade.
- A high-contrast daylight theme.
- Final art assets from section 8.
- Integration into the main Smart Team Tracker shell.

---

## 14. Build phases

The backend is mostly reuse, so these phases are almost entirely front-end. The only backend touch is the one `sport` column and small extensions to existing endpoints.

1. **Data model and event log.** Define the baseball game object (event log plus derived stats) that drops into the existing `games.data` JSONB column, and the replay-to-state engine. Nothing visual yet, but this is the spine.
2. **Live game screen, offline.** Scoreboard, diamond and base surfaces, outcome pad, count and outs, undo, built on the reused component system. Score one fake game by hand.
3. **Pitch count and rules config.** Limits, warnings, run cap, continuous order, subs.
4. **Box score and season rollups.**
5. **Field test build.** PWA install, data export, deploy to its own URL. Hand to friends.
6. **Iterate from feedback**, then tackle deferred items.

---

## 15. Testing plan

- Deploy to a private URL and share the link with a few coaching friends.
- Testers sign in with Google (existing auth) or use guest mode. Signed-in testers get their games synced and safe across devices; guest games live only on that device.
- Ask each to score one real or replayed game and note every moment they were unsure what to tap.
- Success criteria: a tester scores a full game without touching paper, and the box score matches what a paper scorer got.

---

## 16. Data model sketch (for when we start building)

Reuses the existing Supabase tables, with localStorage as the offline mirror. Illustrative shape, to be refined in build phase 1.

- **Team** (own): the existing `teams` row, plus a new `sport` column (`hockey` or `baseball`). Roster holds jersey numbers. No name field for players exists.
- **OpponentTeam**: the existing `opponents` row (team name, per-team, `last_played_at`). Batting history aggregates from saved games.
- **Game**: the existing `games` row. Query columns (date, opponent, level, team_id, user_id) stay as they are, and the whole baseball game lives in the **`data` JSONB column**: `sport: 'baseball'`, level, home/away, innings, run cap, lineups, and an ordered **event log**. No new table.
- **Event** (inside the log, one of): pitch, plateAppearance, baserunning, substitution. Each carries only what it needs, for example a plateAppearance stores batting side, batter number, pitcher number, result code, fielders involved, ball location, RBIs, outs recorded, and the count.
- **Derived state** (never stored, always recomputed from the log): current inning, half, outs, count, base occupancy, score, and all stat lines.

---

## 17. Open decisions

These are my recommendations. Push back on any of them.

1. **Front-end entry point:** build the baseball screens as a separate page in this repo (for example `baseball.html` plus its own JS), sharing the existing `/api`, auth, and Supabase. Testers reach it at its own URL. This keeps it separately testable while reusing everything. Recommendation: separate page, shared backend.
2. **The one schema change:** add a `sport` column to `teams` (default `hockey` so existing teams are untouched). I would also hoist `sport` to a top-level column on `games` so we can list by sport later. Small, safe, and done once.
3. **Sport accent color:** infield-clay burnt-orange as baseball's signature, keeping the blue / red / green / amber constants shared with hockey. Exact hex tuned in the asset phase.
4. **Pitch-limit and rest defaults:** I will seed editable defaults and we confirm the exact numbers against your specific league before relying on them.
5. **Opponent team identity:** opponents are stored by team name plus jersey numbers, reusing the `opponents` table. Team names are not personal data, so this respects the no-names rule. If you would rather label opponents generically (Team A, Team B), that is a one-line change.

---

## 18. Glossary (novice quick reference)

- **Position numbers 1 to 9:** fixed codes for defensive spots (see section 4.1).
- **Plate appearance:** one complete turn at bat, from stepping in to the result.
- **At bat:** a plate appearance that is not a walk, hit by pitch, or sacrifice (used for batting average).
- **Putout / assist / error:** a fielder recorded the out / helped record it / booted the play.
- **RBI:** run batted in, a run that scored because of the batter's action.
- **Force out:** a runner is out because they were forced to advance and the fielder reached the base first.
- **Fielder's choice:** the batter reaches base only because the defense chose to get a different runner out.
- **6-4-3:** shortstop to second baseman to first baseman, the classic double play.
