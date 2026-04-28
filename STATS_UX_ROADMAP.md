# Stats & UX Roadmap

This roadmap covers the next major improvement cycle for SmartTeamTracker: making historical data properly reviewable, adding PP/PK efficiency, introducing per-goalie tracking, and building opponent performance profiles.

All phases are ordered by dependency and value. Phases 1 and 2 have no schema changes and can be built immediately. Phase 3 must be completed before Phase 4 can show full per-goalie season depth.

---

## Phase 1 — Historical Game Review

The biggest coaching gap in the app today. Data is stored; it just isn't presented.

### 1A. Game Detail Modal → Full Summary View

**Problem:** Tapping a game in history opens a flat two-column raw data table. No visual hierarchy, no grouping, no color.

**What changes:**
- `showGameDetail()` is replaced with a properly formatted view using the same section structure as the live post-game summary
- Sections shown: Score headline → WIN/LOSS/TIE tag → Goalie Score ring + Team Score ring (overall only, no component bars) → Shot/Saving grid → Goaltending grid → Offensive context → Defensive context → Goal breakdown cards → Strength situation → Player stats (if saved)
- **Not shown:** Period breakdown (not stored in gameData — acceptable gap), xG detail (not stored — acceptable gap)

**New function:** `renderHistoricSummary(gameData)` — mirrors `renderSummaryScreen()` but reads from a saved `gameData` object instead of live `state`. Called from `showGameDetail()`.

**Data changes:** None — all required fields are already in `gameData`.

### 1B. Prev/Next Navigation in Game Detail Modal

**What changes:**
- Left/right arrow buttons added to the game detail modal header
- Tapping navigates to the previous/next game in the current history list without closing the modal
- Modal header (opponent + date) and stat body update in place
- At first/last game, the respective arrow is disabled

**JS:** `historyList._games` already stores the ordered game array. Track a `currentDetailIdx` integer; arrow taps call `renderHistoricSummary(games[currentDetailIdx ± 1])`.

---

## Phase 2 — Quick Wins

No schema changes required. All data exists; these items surface it better.

### 2A. PP/PK Efficiency

**Problem:** Penalties and strength-tagged goals are tracked separately but never combined into efficiency metrics that coaches expect.

**New saved fields** (add to `gameData` at `renderSummaryScreen` save time — computed from events):
- `PP_GF` — PP goals for: `events` where `type === 'for_goal' && strength === 'PP'`
- `PP_GA` — PP goals against: `events` where `(type === 'goal' || type === 'soft_goal') && strength === 'PP'`

**Per-game display:** In the Strength Situations section on the post-game summary, add below the EV/PP/SH breakdown:
- `PP: X/Y (Z%)` — X = PP_GF, Y = PenaltiesAgainst (our power play opportunities)
- `PK: X/Y (Z%)` — X = PenaltiesFor − PP_GA, Y = PenaltiesFor (our PK situations)
- Include a small "approx." note (penalty count ≈ power play count — close enough for youth hockey)

**Season display:** Add `PP%` and `PK%` tiles to the season Key Stats grid, aggregated across all games.

**Backward compatibility:** Old games without `PP_GF`/`PP_GA` show "—".

### 2B. Key Takeaway Callout

**What changes:**
- Single coaching-focused line added after the score header on the post-game summary
- Identifies the lowest-scoring Team Score component and maps it to plain language:
  - **Discipline** lowest → *"Discipline was the weak point today — penalties hurt the result"*
  - **Possession** lowest → *"Shot volume favored the opponent — outworked in puck control"*
  - **Danger** lowest → *"Too many high-danger chances against — defensive zone coverage"*
  - **Quality** lowest → *"Chances were lower quality — focus on getting to better positions"*
  - **Result** lowest → *"Didn't convert on the chances created"*
- Only shown when `totalShots >= 5` (same threshold as Team Score)

**JS:** After computing `T = computeTeamScore()`, find `Math.min(scoreFin, scoreSS, scoreImp, scoreSQ, scoreDiscipline)` and render the corresponding string. No new computation.

### 2C. Period Start Timestamps

**What changes:**
- When the coach advances to the next period, the app automatically stamps the wall-clock time for the new period — zero extra taps required
- Live game header shows elapsed time since period start: `P2 · 14 min`
- Period 1 is stamped when the first event of the game is logged

**State:** Add `periodStarts: { 1: null, 2: null, 3: null, 4: null }` to state. Period advance logic sets `periodStarts[newPeriod] = Date.now()`. Elapsed time computed on each render as `Math.floor((Date.now() - periodStarts[state.period]) / 60000)`.

### 2D. Split Missed Chances — Live Dashboard

**What changes:**
- The single combined "Missed Chances" tile (For + Against headline, split only in sub-label) is replaced by two tiles:
  - **Missed Ch (Us)** — `state.team.missedChancesFor`
  - **Missed Ch (Them)** — `state.team.missedChancesAgainst`
- Two separate tiles are more glanceable rinkside when a coach wants to know specifically whether their team is wasting chances vs. the opponent wasting theirs

---

## Phase 3 — Goalie Roster & Per-Goalie Tracking

This phase introduces the concept of designated goalies in the roster and attributes all goalie events to the specific goalie who was in net. It is a prerequisite for Phase 4's per-goalie season stats.

### 3A. Designate Goalies in Team Roster

**What changes:**
- In the roster/team setup UI, each player entry gets a "G" badge/toggle to mark them as a goalie
- A player marked as a goalie appears in the active goalie selector at game start and on the mid-game switch sheet
- Skaters and goalies remain in the same roster list — the "G" flag is additive, not a separate section

**Team schema:** Add `goalies: []` (array of jersey number strings) to team data. Toggling a player's "G" badge adds/removes their number from this array. Persisted alongside the roster in TeamManager.

**Backward compatibility:** Teams without a `goalies` field behave exactly as today — no goalie prompts, no attribution.

### 3B. Active Goalie Selection at Game Start

**What changes:**
- If the active team has ≥1 designated goalie, a **"Who's in net?"** step appears after game configuration but before tracking begins
- Shows the team's designated goalies as tap targets; also offers "Untracked" for when you don't want to log by goalie
- If exactly one goalie is designated, they are auto-selected but can be changed
- If no goalies are designated in the roster, this step is skipped entirely — all current behavior is unchanged

**State:** Add `activeGoalie: null` to state (jersey number string, or `null` if untracked).

### 3C. Mid-Game Goalie Switch

**What changes:**
- A **"Switch Goalie"** button added to the live game controls, visible only when at least one goalie is designated in the roster
- Tapping opens a small bottom sheet listing the team's designated goalies; current goalie is highlighted
- Selecting a new goalie logs a `goalie_change` event `{ type: 'goalie_change', from, to, period, timestamp }` and updates `state.activeGoalie`
- All subsequent goalie-related events are attributed to the new goalie

**Per-event attribution:** Each goalie-related event (`shot`, `goal`, `soft_goal`, `big_save`, `smother`, `bad_rebound`, and auto-credited `goodRebound`) stores `goalie: state.activeGoalie` at the time it is logged. Events logged before any designation (activeGoalie is null) are attributed to `'Unknown'`.

**State:** Add `goalieChanges: []` — array of goalie_change event summaries, for display and audit.

### 3D. Per-Goalie Stat Computation

**New helper:** `computeGoalieStatsByPlayer()` — iterates events, groups goalie-related events by their `goalie` field, and returns an array of per-goalie aggregates:
- SA, GA, saves, bigSaves, smothers, goodRebounds, badRebounds, softGoals, HDAg, HDSaves (HDAg − HD goals)
- GoalieScore — computed by passing each goalie's event subset into a refactored `computeGoalieScore(events)` that accepts an optional event array instead of always reading `state.events`

**Refactor:** `computeGoalieScore()` gains an optional `eventsOverride` parameter. When called without it, behavior is identical to today. When called with a subset, it scores only that goalie's events. Both the live summary and per-goalie computation use the same function.

### 3E. Post-Game Summary — Per-Goalie Display

**What changes:**
- **One goalie played:** Display is unchanged — existing rings, component bars, stat grid
- **Multiple goalies played:** The Goalie Score section shows a side-by-side or tabbed breakdown:
  - Each goalie: Score ring + SA faced + SV% + key stats (big saves, bad rebounds, soft goals)
  - Overall Goalie Score (used for season tracking) = SA-weighted average of both goalies' scores
  - A small note shows when the switch occurred: *"Goalie change: P2"*

### 3F. Saved Game Data — Per-Goalie and New Fields

**New fields added to `gameData` at save time:**

| Field | Description |
|---|---|
| `goalies` | Array of per-goalie objects: `{ number, SA, GA, saves, bigSaves, smothers, goodRebounds, badRebounds, softGoals, HDAg, GoalieScore }` |
| `GoodRebounds` | Team-level total good rebounds (enables season stats for pre-Phase-3 games) |
| `HDAg` | Total HD shots against (same rationale) |
| `PP_GF` | PP goals for (also added in Phase 2A) |
| `PP_GA` | PP goals against (also added in Phase 2A) |

**Backward compatibility:** All new fields are additive. Old games without them show "—" for stats that require them — no data is lost or corrupted.

---

## Phase 4 — Season Goalie Depth

*Requires Phase 3 for full per-goalie data. Can partially display using team-level fields (BigSaves, SoftGoals, BadRebounds, Smothers) from older games.*

### 4A. Season Goalie Stats Section

**What changes:**
- New dedicated section added to the season dashboard, below the existing Key Stats grid
- If one goalie has played most games: shows that goalie's season stats
- If multiple goalies have significant time: shows a side-by-side or expandable per-goalie breakdown

**Stats per goalie** (aggregated from `goalies` arrays across all saved games):
- Games in net + record (W-L-T)
- Season SV%
- HD Save Rate: total HD saves ÷ total HD shots against
- Rebound Control %: (good rebounds + smothers) ÷ (good + smothers + bad)
- Soft Goal Rate: soft goals ÷ total GA (lower is better)
- Total Big Saves
- Avg Goalie Score with sparkline trend

**Fallback for games without `goalies` array:** Use team-level `BigSaves`, `SoftGoals`, `BadRebounds`, `Smothers` from gameData. HD Save Rate and Rebound Control % show "—" for those games.

### 4B. Individual Game Goalie Section Enhancements

**What changes on the post-game summary:**
- Save Quality bar annotation: add `X/Y HD shots stopped (Z%)`
- Rebounds annotation: change from raw counts to rate — `Rebound Control: 73% · 8 good, 3 bad, 2 smothered`
- GSAx annotation: add level-calibrated context — *"Saved more goals than a typical [Level] goalie would on this shot mix"* (the `LEVEL_PROFILES` baseline already provides this — surface it)
- If any PP goals against: *"X of Y goals came on a power play (adjusted in score)"*

---

## Phase 5 — Opponent Records

Pure presentation work. No new data required.

### 5A. Opponent Profile View

**What changes:**
- New **"By Opponent"** view accessible from the History panel (toggle between "All Games" and "By Opponent")
- Groups all saved games by opponent name
- Each opponent row shows: name, record (3-1-0), avg score (4.2–2.1), avg Goalie Score, avg Team Score
- Sorted by most games played (most-rematched opponents first)
- Tap an opponent → filtered game list showing only games against them, each tappable using the Phase 1 modal

**JS:** Compute groupings from the already-loaded games array. No API changes — pure client-side grouping.

### 5B. History Panel Filter Bar

**What changes:**
- Filter row added above the history list: **All · Wins · Losses · By Opponent**
- "By Opponent" activates the Phase 5A grouped view
- "Wins" and "Losses" filter the existing chronological list in place

---

## Phase 6 — Polish

### 6A. Shot Share Trend Sparkline

- Add a Shot Share sparkline to the season dashboard alongside the existing Goalie Score, Team Score, and Goals sparklines
- Shows whether puck possession is trending up or down across the season — a useful development indicator for youth teams

### 6B. Recent Form with Scores

- Season dashboard "Recent Results" strip currently shows W/L/T letters only
- Change to show result with score: `4-2 W · 3-3 T · 1-4 L` for the last 5 games
- Keeps the compact format but adds the context coaches actually want

---

## Schema Change Summary

| Field | Phase | Location | Notes |
|---|---|---|---|
| `PP_GF` | 2A | gameData | PP goals for |
| `PP_GA` | 2A | gameData | PP goals against |
| `periodStarts` | 2C | state | Wall-clock start times per period; not persisted to cloud |
| `activeGoalie` | 3B | state | Current goalie jersey number string or null |
| `goalieChanges` | 3C | state | Log of mid-game switches |
| `goalie` on events | 3C | each goalie event | Jersey number at time of event |
| `goalies` array | 3F | gameData | Per-goalie game stats |
| `GoodRebounds` | 3F | gameData | Team-level total |
| `HDAg` | 3F | gameData | HD shots against total |

All additions are backward compatible. Old games without new fields display "—" for affected stats.

---

## Build Order Summary

| Phase | Dependency | Schema changes? |
|---|---|---|
| 1 — Historical game modal + nav | None | No |
| 2 — Quick wins (PP/PK, callout, period stamps, missed chances) | None | 2 new gameData fields |
| 3 — Goalie roster + per-goalie tracking | None | Yes (see above) |
| 4 — Season goalie depth | Phase 3 for full data | No (reads Phase 3 fields) |
| 5 — Opponent records | Phase 1 (modal) | No |
| 6 — Polish | Phase 4 | No |
