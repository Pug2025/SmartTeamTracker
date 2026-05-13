# Opponent Records Plan (Phase 5)

## Goal

Today Past Games is one long reverse-chronological list. Useful for "what
happened recently," not for answering "how have we done against the Wolves
this year?" or "show me every game we lost."

After this change:

- The Past Games panel gets a **filter bar** at the top with four modes:
  **All**, **Wins**, **Losses**, **By Opponent**.
- **All/Wins/Losses** keep the existing flat list, just filtered.
- **By Opponent** is a new grouped view: one collapsible row per opponent
  showing the head-to-head record (3W–1L) + total goals (15–8), tap to
  expand the matching games inline.
- Selecting a filter sticks for the panel session; resets to **All** when
  the panel reopens.

No new data needed — everything derives from existing saved games and the
existing `buildMatchupRecord` helper. View-layer only.

## Design decisions (proposed — flag any you want different)

1. **Tabs, not a dropdown.** Filter bar uses pill-style segmented tabs
   (matches `.player-season-sortbar` pattern already on Player Stats).
2. **Ties land in All only**, not in Wins or Losses. Coaches asking "show me
   losses" don't want ties mixed in. By Opponent always includes everything.
3. **By Opponent: collapsed by default.** Tapping a row toggles its games
   list inline. One row open at a time? Probably not — let multiple stay
   open so you can compare. Easy enough to change later.
4. **By Opponent sort:** most games played first, ties broken by most recent
   game. Coach naturally cares most about the rivals they've seen most. (We
   can offer alternate sorts in Phase 6 polish if useful.)
5. **Each grouped game row reuses the existing `.history-item` markup** —
   same date, score, score class, and tap-to-open Game Detail behavior. The
   swipe-to-delete also keeps working since it's bound to `.history-row`.
6. **Filter bar resets on panel close.** Defaults to All on every fresh
   open. Avoids the surprise of "wait, why am I only seeing losses?"
7. **Filter state is per-panel only**, not persisted. No localStorage.
8. **Coexistence with Phase 7 season selector** (when it lands): Past Games
   will eventually have both a season selector and this filter bar. The
   filter bar sits *below* the season selector so the order reads "what
   season → what subset". Filter applies to whatever the selector currently
   shows.

## Schema changes

None. All derived from `game.data.GF`, `game.data.GA`, and `game.data.Opponent`.

## UI changes (file by file)

### `index.html`

1. **Past Games panel header**: insert a filter bar above `#historyList`.
   ```html
   <div class="history-filter-bar">
     <button class="history-filter-tab active" data-filter="all">All</button>
     <button class="history-filter-tab" data-filter="wins">Wins</button>
     <button class="history-filter-tab" data-filter="losses">Losses</button>
     <button class="history-filter-tab" data-filter="opp">By Opponent</button>
   </div>
   ```

### `js/app.js`

1. **New module-level state**: `historyViewState = { filter: 'all', games: [] }`.
2. **`loadHistoryPanel`** (line 5195): reset `historyViewState.filter = 'all'`,
   active the All tab, store games in `historyViewState.games`, then dispatch
   to the filter renderer.
3. **`renderHistoryList`** (line 5332): split into:
   - `renderHistoryFlat(games)` — existing logic, takes a pre-filtered array.
   - `renderHistoryByOpponent(games)` — new, builds grouped rows.
4. **New `renderHistoryView()`** dispatcher reads `historyViewState.filter`,
   filters/groups, and writes the body. Filter bar tap → call this.
5. **`renderHistoryByOpponent`** logic:
   - Group `games` by `normalizeOpponentName(game.data.Opponent || game.opponent)`.
   - For each group, reuse `buildMatchupRecord(group, opponentName)` to get
     the record/totals (handles ties, GF/GA roll-up).
   - Sort groups by `gamesPlayed` desc, then by newest game date desc.
   - Each group renders as:
     ```
     ┌────────────────────────────────┐
     │ Wolves            3W–1L  15–8 ▾│  ← header row, tap to toggle
     ├────────────────────────────────┤
     │   game row 1                   │  ← collapsed by default
     │   game row 2                   │
     └────────────────────────────────┘
     ```
   - Game rows inside use the same `.history-row` / `.history-item` markup
     so swipe-to-delete and tap-to-detail keep working unchanged.
6. **Filter bar click handler**: toggle `.active` class, update
   `historyViewState.filter`, call `renderHistoryView()`. No re-fetch.
7. **Wins/Losses filtering**: `games.filter(g => Number(g.data?.GF) > Number(g.data?.GA))` and the inverse.
8. **Empty state per filter**: when the chosen filter returns 0 games, show
   a friendly mode-specific message:
   - Wins: "No wins yet this season."
   - Losses: "No losses recorded — good work."
   - By Opponent: "No opponents to group yet." (Only reachable if
     `games.length === 0`, which is already handled upstream.)
9. **Swipe state reset**: any time we re-render the body, call
   `resetHistorySwipeState()` (already done in `renderHistoryList`).
10. **`historyList._games` cache** (used by Game Detail open): keep it
    pointing at the full unfiltered game list so tap-to-detail still works
    regardless of which filter is active.

### `css/styles.css`

- `.history-filter-bar` — flex row, pill tabs, scrolls horizontally on
  narrow widths if needed. Pattern: `.player-season-sortbar`.
- `.history-filter-tab` + `.history-filter-tab.active` — same visual idiom.
- `.history-opp-group` — wrapper for the By Opponent group rows.
- `.history-opp-header` — the tappable header showing opponent + record.
- `.history-opp-body` — the inline expanded games list (hidden by default
  via a CSS class toggle, no JS animation needed).
- `.history-opp-chevron` — small chevron that rotates on `.open`.

### `api`, `js/teams.js`, `js/spectator.js`

No changes.

## Worked example

Three games, all against the Wolves: 4–2 W, 5–3 W, 2–4 L. One game vs
Bears: 3–3 T.

**All filter**: 4 rows, reverse chrono (today's behavior).
**Wins filter**: 2 rows (the two W games vs Wolves).
**Losses filter**: 1 row (the L game).
**By Opponent**: two group rows —
- "Wolves   2W–1L   11–9 ▾"  (tap to expand to 3 game rows)
- "Bears    0W–0L–1T   3–3 ▾"  (tap to expand to 1 game row)

## Backward compatibility checklist

| Surface | Before | After |
|---|---|---|
| Past Games panel open | flat list (current) | filter bar + flat list, defaults to All |
| Tap a game | opens Game Detail | unchanged |
| Swipe to delete | works | unchanged (rows are still `.history-row`) |
| Empty team | "No past games found." | unchanged |
| Season Dashboard / Player Stats | unchanged | unchanged |
| Spectator | unchanged | unchanged |
| Phase 7 season selector | not yet built | sits above filter bar; filter applies inside current season |

## Order of work (one commit per step)

1. **Filter bar + Wins/Losses tabs.** Add the four-tab bar to
   `#historyPanel`, refactor `renderHistoryList` into a dispatcher +
   `renderHistoryFlat`, implement the All/Wins/Losses filters. Empty states.
   No By Opponent yet — that tab is wired but shows a placeholder. Push and
   verify Wins/Losses look right on Mac + iPhone.
2. **By Opponent grouped view.** Implement `renderHistoryByOpponent`, the
   group header + collapsible body, tap-to-toggle. Reuse `.history-row` for
   nested games so swipe-to-delete continues working. Push and verify.
3. **Polish.** Anything flagged during testing — sort tweaks, copy, narrow
   screen layout, animation feel.

## Testing plan

After Step 1:
- Open Past Games. Default = All. Today's flat list should be untouched.
- Tap Wins → list shrinks to wins only; bad-day messages on losses tab if
  team has no losses.
- Tap Losses → list shrinks. Tap All → full list back.
- Test delete (swipe) on a filtered list — game disappears, filter stays.
- Open and close the panel — filter resets to All.
- iPhone: filter bar fits, taps work.

After Step 2:
- Tap By Opponent → opponents grouped, sorted by games played.
- Tap a group → expands inline showing games.
- Tap another group → both can be open.
- Tap a nested game → Game Detail opens, opponent matches.
- Swipe a nested game to delete → game disappears, group record updates on
  next render (close + reopen panel is fine).

## Out of scope (explicit)

- **Persistent filter preference** (remember last tab across opens). Could
  be Phase 6 polish.
- **Sort options inside By Opponent** (most recent, worst record first).
- **Opponent-grouped season stats** beyond W-L-T + GF/GA. Per-opponent
  Goalie Score, shooting%, etc. — future work, not Phase 5.
- **Auto-expand the first / most-recent opponent group** on open.
- **Search / type-to-filter** inside Past Games.
- **Date-range filtering** ("just October").
- **Multi-select filter** (e.g., Wins AND vs Wolves at the same time).

## Locked decisions on UI copy

- Tab labels: **All**, **Wins**, **Losses**, **By Opponent**.
- Empty states:
  - Wins: **"No wins yet this season."**
  - Losses: **"No losses recorded — good work."**
- Group record format: **"3W–1L"** (no T when zero), **"0W–0L–1T"** (T
  shown when nonzero); goal totals on the same row as **"15–8"**.
