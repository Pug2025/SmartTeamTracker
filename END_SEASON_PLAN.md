# End Season Plan (Phase 7)

## Goal

Today every saved game for a team is part of one long, undifferentiated history.
When you start next season you'd see last year's games mixed in with this
year's on the Season Dashboard, Past Games, Player Stats, and the new By
Goalie totals.

After this change:

- Each team has the concept of a **current season** (untagged games) and any
  number of **past seasons** (games stamped with a season label).
- An **End Season** button on the Season Dashboard archives the current
  team's games by stamping them with a season name, then resets the dashboard
  to a clean slate for the next season.
- A **season selector** at the top of season-aware panels (Season Dashboard,
  Past Games, Player Stats) lets you switch between Current, a specific past
  season, or All Seasons.
- Roster and goalies **carry over** — kids mostly return, so we don't reset
  them. You can still manually edit either at any time.
- Opponents are not touched — same league, same opponents next year.

Backward compatible: today's games all have `season = null` and become the
"current season" automatically. End Season is opt-in per team.

## Design decisions (proposed — flag any you want different)

1. **Per-team, not global.** Each team ends its own season independently.
   LL Black can be done for the year while 4v4 Grey keeps going.
2. **`season` is a free-text label** on each game. We don't model "Season" as
   a separate entity. Sorting past seasons is reverse-chronological by the
   newest game in that season (so "2025–26" appears above "2024–25"
   naturally).
3. **Auto-suggested name** based on game dates: if the newest untagged game
   was played in month >= 8 (Aug+) we suggest `{year}–{year+1}`; otherwise
   `{year-1}–{year}`. Hockey-season convention. You can edit the suggested
   name before confirming.
4. **Roster + goalies carry over.** No reset. You'll edit them manually for
   any roster turnover next season.
5. **Opponents carry over.** Same `/api/opponents` rows, unchanged.
6. **Past seasons are read-only views.** You can browse, drill into past
   games, see player stats for that season. You can't add games to a past
   season (newly saved games always go to Current). You *can* still delete
   individual past-season games from Past Games (existing flow).
7. **No "Undo End Season" button**, but the data is recoverable: ending a
   season is just stamping a string on each game's row. If you mis-named or
   want to undo, you can do it via SQL. We can add an in-app "Edit season
   name" later if useful (Phase 7.1).
8. **Reset Season Stats button stays.** It's destructive (deletes games);
   End Season is non-destructive (just tags them). Different buttons for
   different jobs.
9. **Blocked when there are no untagged games.** End Season on an empty
   current season shows a toast "Nothing to archive" and does nothing.

## Schema changes

### Supabase `games` table

```sql
alter table public.games add column if not exists season text;
create index if not exists games_season_idx on public.games(team_id, season);
```

`season` is null for current-season games, a string label for archived games.
The index keeps "list games for team T where season is null" fast as history
grows. You'll need to run this DDL once when we get to Step 1.

### Saved gameData

No change. The season tag lives on the `games` row (`game.season`), not in
the JSON blob. Keeps queries server-side and indexable.

### State / localStorage

No new state. The "current season" is implicit (= games with season = null).
No active-season pointer needed.

## API changes

### `api/games/index.js`

1. **GET**: accept optional `season` query param.
   - `season=current` → adds `&season=is.null` to the Supabase URL.
   - `season=all` (or absent) → no filter. Keeps existing behavior for any
     caller that doesn't pass it.
   - `season=<label>` → `&season=eq.<encoded label>`.
2. **GET (new)**: when called with `?seasons_list=1&team_id=X`, return the
   distinct list of season labels for that team plus a `currentCount` (count
   of `season is null` rows). One round-trip drives the season selector.
3. **DELETE**: pass through optional `season` filter so "Reset Season Stats"
   only deletes the *current* season's games (we'll switch the existing
   button to pass `season=current`).

### New endpoint: `api/end-season.js`

Single-purpose POST endpoint:

```
POST /api/end-season
Body: { teamId: "t_xe00m5mymmcm6qs3", seasonName: "2025–26" }
```

- Auth required (Firebase JWT, same pattern as `api/teams.js`).
- Rate limit: 3/min per user.
- Validates `seasonName` is a non-empty trimmed string, length ≤ 60, not
  already a label on this team's games (return 409 with a useful message
  if collision — auto-suggested names are deterministic so a double-tap of
  End Season would otherwise collide silently).
- Updates `games` set `season = $name` where `team_id = $teamId` and
  `user_id = $uid` and `season is null`. Returns the rows-affected count.
- Returns 200 `{ success:true, archived: N, seasonName: "2025–26" }`.

## UI changes (file by file)

### `index.html`

1. **Season Dashboard panel** (`#seasonPanel`):
   - Add a header row with a **season selector** (`<select id="seasonSelect">`).
     Options: "Current Season", each past season, "All Seasons". Defaults
     to Current.
   - Add an **End Season** button (`#btnEndSeason`) in the panel footer
     alongside the existing "Reset Season Stats" button. Visually softer
     (neutral grey, not destructive red). Hidden when the active selector
     is not "Current".
2. **End Season modal** (`#endSeasonModal`):
   - Title: "End the season?"
   - Body: "{teamName} has {N} games in the current season. Archive them
     under this name:"
   - Text input `#endSeasonNameInput` pre-filled with the auto-suggested
     label ("2025–26").
   - Footer: Cancel / End Season buttons. End Season disabled until name
     has content.
3. **Past Games panel** (`#historyPanel`):
   - Add the same `#historySeasonSelect` dropdown above the games list.
4. **Player Stats panel** (`#playerStatsPanel`):
   - Add the same `#playerStatsSeasonSelect` dropdown above the stats body.

### `js/app.js`

Main work lives here. Touch points:

1. **`getGameQueryScope()`** (line 4574): no change.
2. **`buildGamesApiUrl()`** (line 5045): accept optional `season` param;
   when set, append `&season=<value>`. Default behavior unchanged.
3. **`fetchScopedGames(limit)`** (line 5055): accept optional season arg;
   pass through to `buildGamesApiUrl`. Default `'current'` so all existing
   callers automatically scope to current season.
4. **Season selector state**: a small module-level object
   `seasonViewState = { season: 'current', dashboard, history, playerStats }`
   so each panel can remember independently. (Or one shared selector — TBD;
   I'll go with per-panel state to avoid surprising the user.)
5. **`loadSeasonPanel`** (line 5141): fetch the seasons list once, populate
   `#seasonSelect`, then fetch games for the selected season and render.
   Toggle `#btnEndSeason` visibility based on selector == 'current'.
6. **`loadHistoryPanel`** + **`loadPlayerStatsPanel`**: same season-selector
   wiring.
7. **End Season click handler**:
   - Open modal pre-filled with `suggestSeasonName(latestGameDate)`.
   - On confirm: POST `/api/end-season`, await result, refresh all three
     panels (`refreshSeasonPanelIfOpen`, `refreshHistoryPanelIfOpen`,
     `refreshPlayerStatsPanelIfOpen`), show toast "{N} games archived as
     {name}."
8. **`suggestSeasonName(dateStr)`** helper: returns `YYYY–YY` based on the
   month-≥8 rule.
9. **`resetSeasonStats`** (line 5107): pass `season=current` to the DELETE
   so it only nukes the current season, not past archives. Update confirm
   text from "deletes all saved games for that team" to "deletes all saved
   games for the current season". (Past-season games stay safe.)
10. **`renderSeasonDashboard`**: no logic change; it renders whatever games
    array it's handed. The season selector controls which games arrive.
11. **`renderPlayerStatsDashboard`**: same — agnostic to which season.
12. **By Goalie season totals** (line 6210 area): same — agnostic.

### `js/teams.js`

No change. Teams aren't season-scoped.

### `js/spectator.js`

No change. Spectator view is per-game, not season-aware.

### `css/styles.css`

- Style for `.season-selector-row` (selector chip on each panel header).
- Style for the End Season button — neutral, not destructive.

## Auto-suggested season name

`suggestSeasonName(date)`:

```
month = date.getMonth() + 1       // 1-12
year  = date.getFullYear()
startYear = month >= 8 ? year : year - 1
endYY     = String(startYear + 1).slice(-2)
return `${startYear}–${endYY}`     // e.g., "2025–26"
```

Source date: the newest untagged game's `date` field. If the team has zero
untagged games, the button is disabled and we never get here.

## Backward compatibility checklist

| Surface | Before End Season is ever used | After first End Season |
|---|---|---|
| Season Dashboard | shows all games (Current selector default; season is null = all existing games) | Current shows new games; past season available in dropdown |
| Past Games | shows all games (Current default) | Current default; past seasons in dropdown |
| Player Stats | aggregates all games | aggregates current season; past seasons in dropdown |
| By Goalie totals | aggregates all games | scoped by selector |
| Reset Season Stats | deletes everything (today) → after Step 1, deletes current season only | unchanged |
| Save game | season = null | unchanged — new games always go to Current |
| Spectator share | unchanged | unchanged |
| `/api/games` (no season param) | unchanged behavior (returns all) | unchanged for legacy callers |

Existing games keep working because `season is null` is the natural default
for "Current". No migration of historical data needed.

## Order of work (one commit per step)

1. **Schema + API plumbing.** DDL on Supabase (you run it). Update
   `api/games/index.js` to accept the `season` filter and the
   `?seasons_list=1` endpoint. Add `api/end-season.js`. Update
   `buildGamesApiUrl` + `fetchScopedGames` to scope to `'current'` by
   default. No UI yet. Push and verify nothing visibly changes.
2. **End Season button + modal.** Add `#btnEndSeason` and `#endSeasonModal`
   to the Season Dashboard footer. Wire the confirm flow → POST endpoint →
   refresh panels + toast. Push and verify end-to-end on one team.
3. **Season selector on Season Dashboard.** Dropdown at the top of the
   panel; switches the games array used by `renderSeasonDashboard`. Show
   the End Season button only when selector is "Current". Push and verify
   you can browse the just-archived season.
4. **Season selector on Past Games.** Same pattern on `#historyPanel`.
5. **Season selector on Player Stats.** Same pattern on `#playerStatsPanel`.
6. **Polish.** Empty states ("No games this season yet"), the
   "Reset Season Stats" confirm copy update, CSS tightening.

Each step is independently testable and reversible. Step 1 silently changes
the default scope from "all" to "current", but since no game has a season
yet, the visible behavior is identical until you tap End Season.

## Testing plan

After each step, on Mac browser and iPhone:

- Step 1: run DDL, deploy, confirm Season Dashboard / Past Games / Player
  Stats still render exactly as before with all today's games.
- Step 2: tap End Season on LL Black with a few games. Verify the toast,
  Season Dashboard now reads "No games yet" (because they all moved to a
  past season). Check Supabase that the `season` column is populated on
  those rows. Try again on the empty current season — should toast "Nothing
  to archive."
- Step 3: select the just-archived season from the dropdown. Verify dashboard
  re-renders with those games and the End Season button is hidden.
- Step 4: same drill on Past Games — switch between Current, the past
  season, and All Seasons. Verify the games list filters correctly.
- Step 5: same drill on Player Stats.
- Step 6: walk through with an empty 4v4 Grey team (no games yet) — empty
  state should be friendly, button disabled.

## Out of scope (explicit)

- **Editing a season's name** after ending it. Possible Phase 7.1.
- **Merging two seasons.** SQL-only if needed.
- **Splitting an existing season** into two. SQL-only if needed.
- **Per-season roster snapshots.** The current model is "roster carries
  over." If you want a 2024–25 roster preserved as it was on that date,
  that's a future feature.
- **Spectator per-season view.** Spectator is per-game.
- **Season filter on the live game screen.** Live is always the new game;
  no season context.

## Locked decisions on UI copy

- Button label: **"End Season"**.
- Modal title: **"End the season?"**.
- Modal body: **"{teamName} has {N} games in the current season. Archive
  them under this name:"**.
- Toast on success: **"{N} games archived as {seasonName}."**.
- Empty-state toast: **"Nothing to archive."**.
- Reset Season Stats confirm (updated): **"Reset stats for the current
  season? This deletes all current-season games for this team. Past seasons
  are not affected."**.
