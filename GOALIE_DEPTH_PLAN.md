# Goalie Depth Plan (Phase 4)

## Goal

Phase 3 gave us per-goalie raw counts: shots, saves, SV%, big saves, smothers,
soft goals, GA. That's useful but doesn't tell you *what kind of goalie* a
kid is. Two goalies with identical 0.875 SV% can have very different
profiles — one stops the easy stuff and lets in the hard chances, the other
gets shelled with high-danger looks and still hangs on.

After this change every per-goalie view (in-game summary, historic summary,
season By Goalie totals) adds three derived rate metrics:

1. **HD SV%** — Save percentage on high-danger shots only.
2. **Reb Ctrl %** — Rebound control: of save events that produced a tracked
   rebound outcome, how many were "good" (no follow-up shot within 3s) vs
   "bad" (rebound led to another shot against).
3. **Soft%** — Soft goals as a percentage of goals against. Lower is better
   — a kid who lets in 4 goals where none are softies looks very different
   from one whose 4 goals are all soft.

All three are computed from existing event fields (`highDanger`,
`goodRebound`, soft_goal vs goal). No new event tagging, no schema changes
to the events themselves.

## Design decisions (proposed — flag any you want different)

1. **No per-goalie Goalie Score (the 0–100 ring) yet.** That's a bigger
   piece — different goalies face different shot quality, so a fair
   per-goalie score needs weighting. Out of scope here. We're delivering
   stat rates, not a composite score.
2. **HD SV% denominator = high-danger shots faced** (shot + goal + soft_goal
   + big_save + bad_rebound, all with `highDanger=true`). Matches the
   existing `hdAg` definition in `quantifyShotQuality()` (line 1781) so
   numbers line up.
3. **Reb Ctrl denominator = goodRebounds + badRebounds**, not total saves.
   Reason: we only know the outcome of saves where the rebound *was*
   resolved (a follow-up shot logged within 3s = bad, otherwise = good).
   Saves where the puck was cleared but no shot followed within the window
   shouldn't count as either. The existing event linker already enforces
   this — we just match its semantics. Displays "—" when denom is 0.
4. **Soft% denominator = goalsAgainst**, including soft goals (soft goals
   *are* goals against). So Soft% = softGoals / goalsAgainst. Displays "—"
   when 0 GA.
5. **Old games keep working.** Saved games from before Phase 4 don't have
   `hdShots`/`hdSaves` on their per-goalie entries. Season aggregation
   treats missing fields as 0; the per-game table renders "—" for those
   rates on historic summaries of old games. No retroactive backfill.
6. **Where the metrics appear:**
   - Live per-goalie breakdown table (post-game summary)
   - Historic per-goalie breakdown (Game Detail modal)
   - Season "By Goalie" totals (Season Dashboard)
   - Not on the live in-game screen — too noisy mid-game, and the data isn't
     stable enough to be useful before the game is over.
7. **No spectator changes.** Spectator view stays at aggregate goalie level.

## Schema changes

### Event objects

No change. `highDanger` and `goodRebound` are already on the relevant events.

### `computeGoalieBreakdown()` return shape (extended)

Each per-goalie object gains two fields:

```js
{
  id, shots, saves, goalsAgainst,
  bigSaves, smothers, goodRebounds, badRebounds, softGoals,

  // NEW
  hdShots: 7,   // HD shot-against events tagged to this goalie
  hdSaves: 6    // HD saves = hdShots minus HD GAs (goal + soft_goal w/ HD)
}
```

Other rate stats (Reb Ctrl, Soft%) are computed at render time from
existing fields — no need to materialize them in the breakdown object.

### Saved `gameData.goalies` entries

```js
gameData.goalies = [
  { id:'31', shots:17, saves:15, ...,
    hdShots:7, hdSaves:6 },     // NEW fields
  ...
]
```

Old saved games omit these fields. Readers default missing values to 0.

### Supabase

No changes. Per-goalie stats live inside the games row's `data` jsonb blob.

## UI changes (file by file)

### `js/app.js`

1. **`computeGoalieBreakdown()`** (line 2385):
   - Init `hdShots:0, hdSaves:0` on each goalie object in `ensure()`.
   - In the switch, when the event has `highDanger`:
     - `shot`, `big_save`, `bad_rebound`: `hdShots++; hdSaves++`
     - `goal`, `soft_goal`: `hdShots++`  (no save credit)
2. **`buildGoalieBreakdownTable()`** (line 2431):
   - Add three columns to the table header: HD SV%, Reb Ctrl, Soft%.
   - Compute each rate per row with the conventions in design decision #3–#4.
   - Display "—" when denom is 0.
   - Keep the existing column ordering; new columns go on the right.
3. **Save flow** (~line 2540 area, where `gameData.goalies` is built): no
   code change — `computeGoalieBreakdown()` already returns the goalie
   objects; we just pick up the new fields automatically when we save.
4. **`renderSeasonDashboard` per-goalie block** (~line 6210):
   - Extend the season aggregation loop to also sum `hdShots`, `hdSaves`,
     `goodRebounds`, `badRebounds`, `softGoals` (already summing some of
     these — verify and round out).
   - Add the three rate columns to the season By Goalie table, matching the
     per-game table column layout exactly.
   - Handle missing fields on old saved games as 0.
5. **Historic per-goalie table** — uses the same builder (`buildGoalieBreakdownTable`)
   so it inherits the new columns automatically. Verify.

### `index.html`

No structural changes. The per-goalie table is rendered into existing
wrappers (`#sumPerGoalieWrap`, the historic equivalent, the season By Goalie
section).

### `css/styles.css`

- The per-goalie table will be wider with three new columns. On narrow
  phones, may need a horizontal scroll wrapper or smaller font. Pattern to
  follow: existing `.breakdown-card` scrolling/overflow rules.
- No new visual primitives.

### `api/games/index.js`

No change. The new fields ride along inside `data` jsonb.

### `js/spectator.js`

No change.

## Worked example

Suppose goalie #31 faced these tagged events in a game:
- 8 plain shots, all stopped, 2 HD
- 3 big_saves (always HD by definition)
- 1 bad_rebound, HD
- 1 goal against, HD
- 1 soft_goal, not HD

Then:
- shots = 8 + 3 + 1 + 1 + 1 = **14**
- saves = 8 + 3 + 1 = **12** (the goal + soft_goal aren't saves)
- goalsAgainst = **2**, softGoals = **1**
- SV% = 12/14 = .857
- hdShots = 2 + 3 + 1 + 1 = **7** (HD plain shots + all big_saves + HD
  bad_rebound + HD goal)
- hdSaves = 2 + 3 + 1 = **6** (HD shots, big_saves, bad_rebound — minus
  HD goal)
- **HD SV%** = 6/7 = .857
- Reb Ctrl: assume goodRebounds=3, badRebounds=1 → 3/4 = **75%**
- **Soft%** = 1/2 = **50%**

## Backward compatibility checklist

| Surface | Game played before Phase 4 | Game played after Phase 4 |
|---|---|---|
| In-game summary (no historic data) | unchanged | new columns populated |
| Historic per-goalie table | new columns render as "—" (no `hdShots` field) | new columns populated |
| Season By Goalie totals | old games contribute 0 to HD/rebound/soft sums → rates only reflect new games | rates populated across all post-Phase-4 games |
| `gameData` save | unchanged | adds `hdShots`/`hdSaves` per goalie |
| Spectator | unchanged | unchanged |

Note that the season aggregation will look "thin" until a few post-Phase-4
games are logged — old games drag the HD-shot denominator toward zero. This
is honest and self-healing as new games are recorded.

## Order of work (one commit per step)

1. **Extend `computeGoalieBreakdown` + table renderer.** Add `hdShots`/`hdSaves`
   tracking; add HD SV%, Reb Ctrl, Soft% columns to `buildGoalieBreakdownTable`.
   Since both live and historic views use this builder, the new columns
   appear in both. Verify on Mac + iPhone with a logged game. Push.
2. **Season By Goalie aggregation.** Extend the season-dashboard per-goalie
   loop to sum the new fields, mirror the three rate columns on the season
   table. Push and verify.
3. **Polish.** Narrow-screen overflow (horizontal scroll if needed),
   column-header tooltips/legend if the abbreviations aren't clear,
   anything else flagged in testing.

Each step is independent. Step 1 alone delivers the per-game value; Step 2
delivers the season payoff. Step 3 is whatever you flag during use.

## Testing plan

After Step 1, on Mac + iPhone:
- Play a quick rink-side practice run: log a handful of HD and non-HD shots,
  a couple of big saves, a bad rebound, one soft goal. End game.
- Check post-game summary: each goalie's row shows HD SV%, Reb Ctrl, Soft%
  with sensible values. Cross-check denom edge cases (0 HD shots → "—",
  0 GA → Soft% = "—").
- Open Game Detail on the just-saved game: same columns appear and match.

After Step 2:
- Open Season Dashboard, scroll to By Goalie: rates aggregated across all
  games. Old games (pre-Phase 4) contribute 0 HD shots; rates should reflect
  post-Phase-4 games proportionally.

After Step 3:
- Walk through on iPhone narrow viewport — make sure the wider table doesn't
  break the layout.

## Out of scope (explicit)

- **Per-goalie Goalie Score (0–100 ring).** Different goalies face different
  shot quality, so a fair score needs weighting and calibration. Future
  work, not Phase 4.
- **Retroactive backfill of `hdShots`/`hdSaves` on old games.** Old games
  predate goalie tagging entirely, so there's nothing to recompute.
- **HD breakdown by shot location.** We only know HD vs non-HD, not where.
- **Spectator depth view.** Spectator stays aggregate.
- **Goalie comparison view** (side-by-side two goalies on the season). Could
  be a small follow-up but not in scope here.

## Locked decisions on UI copy

- Column headers: **HD SV%**, **Reb Ctrl**, **Soft%**.
- Empty value: **—** (em dash) when a denominator is zero.
- No tooltips planned at first; if any header is unclear after Step 1 we'll
  add a small legend row below the table in Step 3.
