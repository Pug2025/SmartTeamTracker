# Goalie Tracking Plan (Phase 3)

## Goal

Today every goalie-credited event (big save, smother, bad rebound, soft goal,
goal against) is logged anonymously and attributed to "the team's goalie" in
aggregate. If two kids split a game, there's no way to tell who saved what.

After this change:

- Teams maintain a separate **Goalies** list alongside the existing roster.
- At game start (when more than one goalie is on the team), a "Who's in net?"
  picker chooses the starter. Single-goalie teams auto-select.
- A **Switch Goalie** button on the live screen lets you change goalies
  mid-game when a kid gets pulled.
- Every goalie event records who was in net at the time.
- Post-game summary and season dashboard break stats down per goalie.

All backward compatible — old games (no goalie tagging) still render with one
combined goalie row.

## Design decisions (locked in from Q&A)

1. **Goalies are separate from skaters.** Two arrays on a team: `roster`
   (skaters) and `goalies`. No flag-on-a-skater hybrid — at U10+ kids don't
   swap positions.
2. **Active goalie is sticky.** Once set, every subsequent goalie event tags
   them. Only changes when you explicitly tap Switch Goalie.
3. **Single-goalie teams skip the start picker** and don't show the Switch
   button.
4. **Per-goalie season aggregation is the deliverable** — coaches need to see
   individual SV%, big saves, soft goal rate, etc. across the season.
5. **Existing games don't need retro-tagging.** They render the old way (one
   combined goalie line) and don't pollute per-goalie season stats.

## Schema changes

### Team object (already partially synced via /api/teams)

```js
team = {
  id, name, level,
  roster:  ['7','12','22', ...],   // skaters — existing field, unchanged
  goalies: ['31','1', ...]         // NEW — string per goalie (jersey or name)
}
```

`goalies` is an array of free-text strings, matching `roster`'s shape. For
numbered teams it'll be jersey numbers; for the 4v4 Grey team (no numbers),
it'll be names. Sort logic already handles both via numeric-then-alpha
fallback (`renderHistoricSummary` line ~5190).

### State (in-memory)

```js
state.activeGoalie = '31'    // NEW — string that matches an entry in
                             // the active team's goalies array, or null
                             // when no goalies are configured
```

Persists in localStorage with the rest of `state`. Reset on new game.

### Event objects

```js
ev.goalie = '31'             // NEW, optional — present only on goalie-
                             // relevant events. null for old events.
```

Goalie-relevant event types: `big_save`, `smother`, `bad_rebound`, `soft_goal`,
`goal` (against us). Non-goalie events (shots, our-side stats) never get this
tag.

### Saved gameData

```js
gameData = {
  ...existing fields,
  goalies: [
    { id:'31', shots:17, saves:15, bigSaves:3, smothers:1,
      badRebounds:0, softGoals:1, goalsAgainst:2 },
    { id:'1',  shots:5,  saves:4,  bigSaves:0, smothers:0,
      badRebounds:1, softGoals:0, goalsAgainst:1 }
  ]
}
```

Per-goalie aggregates built from event tags at save time. Old saved games
omit this field entirely; readers default to undefined and show the combined
view.

### Supabase `teams` table

No schema change needed — `roster` is already `jsonb`, and `goalies` rides
along on the same row. The existing `/api/teams` PUT endpoint upserts the
full team object, so it'll pick up the new array automatically. I'll add
basic validation in `api/teams.js` to whitelist the new field.

## UI changes (file by file)

### `index.html`

1. **Team manager form** (around line ~1444 — `teamForm`):
   - Add a second textarea labeled "Goalies (one per line)" beneath the existing roster textarea.
   - `id="teamGoaliesInput"`.

2. **Game setup screen** — show "In net: #31" next to roster context when goalies are configured.

3. **Live game screen** (header / control row):
   - Small chip: `In net: #31  [↻]` — visible only when team has 2+ goalies.
   - Tap opens existing picker modal pattern (reuse `pickerGrid` style) listing other goalies.
   - Single-goalie teams: show passive label, no switch action.

4. **Pre-game "Who's in net?" modal**:
   - New modal `goalieStartModal`. Triggered when Start Game pressed and team.goalies.length > 1 and state.activeGoalie is null/invalid.
   - One-column picker of goalies. Required choice — no skip.

5. **Summary screen** (post-game):
   - Goalie Score section: when game has 2+ goalies tagged, show per-goalie rows beneath the existing rings (SV%, saves, etc. per goalie).
   - When single goalie or no tagging: render as today.

6. **Game Detail modal** (historic summary):
   - Mirror the same per-goalie breakdown when `gameData.goalies` is present.

7. **Season dashboard**:
   - New "Goalies" section beneath Key Stats with one row per goalie aggregating across the season (GP, total saves, SV%, big saves, soft goal rate).

### `js/teams.js`

- Update `createTeam` / `updateTeam` signature: accept an optional `goalies` field. Default to `[]` if missing.
- `normalizeTeam` (cloud sync): preserve `goalies` array on read.
- Roster getters unchanged.

### `js/app.js`

Main work lives here. Touch points:

1. **State init** (line 334 area): add `activeGoalie: null`.
2. **resetCurrentGame** (line 2584): set `state.activeGoalie = null` and clear it from per-event tagging context.
3. **Start Game handler** (line 470-ish): before flipping to active, check if active team has 2+ goalies. If yes and no `state.activeGoalie` already set, show `goalieStartModal` and defer the rest until choice is made.
4. **addEvent / event creators**: when creating a goalie-relevant event, tag `ev.goalie = state.activeGoalie`. Apply to existing handlers for shot-against, save, smother, big save, bad rebound, soft goal, goal against.
5. **Switch Goalie picker** handler — set `state.activeGoalie` to new value, save state, show toast.
6. **Summary computation**: new helper `computeGoalieBreakdown()` that walks `state.events` and builds the per-goalie aggregates.
7. **gameData save** (line 2539 area): include `goalies` array built from `computeGoalieBreakdown()`.
8. **`renderSummaryScreen`**: when breakdown has 2+ entries, render per-goalie rows. When 1 entry or none, render existing combined view (no UI regression).
9. **`renderHistoricSummary`**: same per-goalie block, gated on `gameData.goalies` presence.
10. **`renderSeasonDashboard`**: new section aggregating per-goalie across all games' `goalies` arrays.
11. **Team manager form save** (`saveTeamFromForm`, line 3678 area): read `teamGoaliesInput`, split-and-trim same as roster, pass into createTeam/updateTeam.
12. **Defensive fallback team manager** (line 3378-ish): mirror the `goalies` field handling so the offline-fallback path doesn't drop it.

### `js/spectator.js`

Spectator view doesn't currently show goalie identity. **Out of scope for
this phase** — won't break it; spectators continue to see aggregate goalie
stats only. If you want spectator per-goalie later, separate task.

### `css/styles.css`

- Style for the "In net" chip.
- Style for per-goalie rows in summary (similar to existing player-stats table).

### `api/teams.js`

Tiny change: add `goalies` to `validateTeam()`'s allowlist with the same
sanitization as `roster` (array, max length, drop non-string entries).

## Logic / scoring changes

The existing Goalie Score (`computeGoalieScore`) is computed from the full
state — it doesn't need to change. It's still useful as "team goaltending
score for this game."

What changes is the **display**: when 2+ goalies have logged events, we show
per-goalie stats beneath the team-aggregate Goalie Score ring. We are
explicitly **not** computing per-goalie Goalie Score in this phase — that's
complex (different shot quality faced, etc.) and was scoped to Phase 4 in
the roadmap.

So the rule is: this phase delivers per-goalie **stat counts** (saves, SV%,
big saves, soft goals, etc.), not per-goalie scores.

## Backward compatibility checklist

| Surface | Old game | New game (1 goalie) | New game (2+ goalies) |
|---|---|---|---|
| Live screen | works as today | works as today + sticky tag in net | "In net" chip + Switch button |
| Pre-game flow | works as today | works as today (auto-select) | "Who's in net?" picker |
| Summary | works as today | combined rows (1 goalie) | per-goalie rows |
| Historic summary | works as today | works | per-goalie when `gameData.goalies` present |
| Season dashboard | hidden | aggregated as one | aggregated per-goalie |
| Team manager | works | works + goalies textarea | works + goalies textarea |
| /api/teams | works | works (goalies upserted) | works (goalies upserted) |
| /api/games save | works | adds `goalies` field | adds `goalies` field |
| Spectator | works | works | works (aggregate only) |

## Order of work (one commit per step)

1. **Schema groundwork** — add `goalies` to TeamManager (sync.js + cloud
   normalize, validation in api/teams.js), and `activeGoalie` to state. No
   UI yet. Push and verify no regression.
2. **Team form** — add Goalies textarea to team manager modal; wire to
   TeamManager.updateTeam/createTeam. Push and verify you can edit goalies
   on each of your three teams.
3. **Pre-game picker** — `goalieStartModal`, auto-select for single goalie,
   start-game gating logic. Push and verify the flow.
4. **Live switch** — "In net" chip + Switch Goalie picker, sticky tagging
   on subsequent events.
5. **Save + summary** — `computeGoalieBreakdown`, gameData.goalies on save,
   per-goalie display in live summary and historic summary.
6. **Season per-goalie** — aggregation block on season dashboard.
7. **Polish** — CSS, edge cases, anything you flag during testing.

Each step is independently testable and reversible. The first 4 commits are
plumbing + UI but don't change any saved data. Commit 5 is when stat data
starts getting tagged with goalies in saved games — past that point, your
games will start carrying the new field.

## Testing plan

Done at each step on both Mac and iPhone:

- Step 1: edit your three teams in Supabase to add some goalies via API
  (or wait for Step 2). Cloud sync should preserve them across devices.
- Step 2: add "31" and "1" as goalies to LL Black. Verify both devices see
  them after sign-in.
- Step 3: start a game with LL Black → picker appears → choose #31 →
  proceeds. Start another game on 4v4 Grey (assuming you've added a single
  goalie) → no picker, auto-selected.
- Step 4: tap Switch Goalie mid-game → pick #1 → toast confirms → next save
  event you log should attribute to #1.
- Step 5: end game → summary shows two goalie rows with the right splits.
  Reload, open historic summary → same view.
- Step 6: season dashboard shows per-goalie totals.

## Out of scope (explicit)

- **End Season feature.** You called this out separately. It's a different
  workflow (archive current games/roster, start a fresh season). I'll write
  a separate short plan for it after Phase 3 is in. Probably becomes "Phase
  3.5" or part of Phase 5.
- **Per-goalie Goalie Score.** Score weighting per goalie was Phase 4 on
  the roadmap. This phase delivers raw stats only.
- **No-number 4v4 rosters.** The existing app already handles non-numeric
  roster entries via numeric-then-alpha sort. No special handling needed
  here; the goalie list works the same way.
- **Spectator per-goalie view.** Spectators continue to see aggregate
  stats only.
- **Pulling existing games to add retroactive goalie tags.** You said your
  saved games are from a season that's done and don't need this. Confirmed
  out of scope.

## Locked decisions on UI copy

- Chip label: **"Goalie: #31"**.
- Switch confirm prompt: **"Are you sure you want to switch the goalie?"** —
  shown after the picker selection, before the active goalie actually changes.
