# Team Sync Plan — make teams persist across devices

## Goal

Today: teams (and rosters) live only in the browser's localStorage on the device
that created them. Games go to Supabase tagged with that device-local `team_id`.
Result: signing in on a new device shows an empty app, and any games saved
beforehand become "orphaned" by team_id (as just happened on iPhone vs Mac).

After this change: teams are persisted to Supabase scoped to the authenticated
Firebase user. Any signed-in device pulls the same teams with the same ids.
localStorage becomes a local cache for offline use.

Guest mode (no auth) keeps working exactly as today — localStorage only.

## Design principles

1. **localStorage stays as the synchronous source.** Every existing call site
   (`TeamManager.loadTeams()`, `getActiveTeam()`, etc.) is synchronous and
   returns immediately from localStorage. Cloud sync is a layer on top.
2. **Cloud is the source of truth for authenticated users.** On sign-in, pull
   from cloud, write the result into localStorage, repaint UI.
3. **Writes are fire-and-forget.** Every `createTeam` / `updateTeam` /
   `deleteTeam` writes localStorage immediately (existing behavior unchanged),
   then asynchronously pushes to cloud. UI doesn't block on the network.
4. **No call-site changes.** The TeamManager API surface stays sync. We add
   `syncFromCloud()` / `pushAllToCloud()` as new methods used only by the
   auth-ready hook and the migration flow.
5. **Backward compatible.** If cloud is unreachable or returns errors, fall back
   to localStorage. App keeps working offline.
6. **Active team id stays local.** Different devices may legitimately have
   different active teams. Don't sync that.

---

## Step 1 — Supabase schema (Jamie runs SQL once)

```sql
create table if not exists public.teams (
  id          text primary key,                    -- existing t_xxx ids
  user_id     text not null,                       -- Firebase uid
  name        text not null,
  level       text default 'U11',
  roster      jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists teams_user_id_idx on public.teams (user_id);
```

**Security model:** matches existing `games` table. RLS is *not* used; access is
gated at the API layer via Firebase JWT verification + `user_id` filter on every
query. Consistent with how `/api/games`, `/api/opponents`, etc. work today.

---

## Step 2 — New API endpoint: `api/teams.js`

Single file. Same shape as `api/games/index.js`. Three methods:

- `GET /api/teams` → list all teams for authenticated user
  - Response: `{ success: true, teams: [...] }`
  - 401 if no/invalid auth token
- `PUT /api/teams` → upsert one team (idempotent by id)
  - Body: `{ id, name, level, roster }`
  - Validates: id is `t_*` format, name is non-empty string, roster is array
  - Uses Supabase upsert on `id` primary key
  - Response: `{ success: true, team: {...} }`
- `DELETE /api/teams?id=xxx` → delete one team for this user
  - Scoped to `user_id = uid AND id = ?id` so a user can't delete someone
    else's team even if they guess the id
  - Response: `{ success: true }`

Rate limits (same pattern as `/api/games`): 60/min reads, 30/min writes, 10/min
deletes per user.

---

## Step 3 — `js/teams.js` changes

Keep the existing sync API. Add cloud sync internals.

**New constants:**
```js
const CLOUD_SYNCED_KEY = 'team-tracker-cloud-synced';  // bool — did we do the
                                                       // initial pull?
```

**New private function `cloudFetch(path, opts)`** — wraps fetch with auth header
(same pattern as `authHeaders()` in app.js — get the Firebase token from
`window.getAuthToken`). Returns null on failure rather than throwing.

**New public functions:**

- `async syncFromCloud()` —
  1. If no auth user, return immediately (guest mode).
  2. `GET /api/teams`.
  3. On success: replace localStorage cache with the returned array. If the
     cache previously had teams the cloud doesn't (local-only teams from before
     this update), keep them locally and push them up via `pushTeam()` for each.
     This is the migration path for Jamie's Mac.
  4. Repaint UI by calling existing `applyActiveTeam()` / team manager modal
     repaint hooks (exposed via `window.refreshTeamUI`).
  5. Mark `CLOUD_SYNCED_KEY` = true.
  6. On failure: keep localStorage as-is, don't repaint. Show non-blocking
     toast "Teams couldn't sync — using local copy."

- `async pushTeam(team)` — `PUT /api/teams` with the team object. Silent
  failure; logs to console.

- `async pushDelete(id)` — `DELETE /api/teams?id=...`. Silent failure.

**Modified existing functions:**

- `createTeam` — unchanged sync behavior, then `pushTeam(team)` fire-and-forget
- `updateTeam` — unchanged sync behavior, then `pushTeam(updated)`
- `deleteTeam` — unchanged sync behavior, then `pushDelete(id)`
- `syncRosterToActiveTeam` — calls existing `updateTeam` which now pushes

All push calls bump the team's `updated_at` server-side (default `now()`).

---

## Step 4 — Auth hook in `js/auth.js`

In the existing `onAuthStateChanged` callback, after the `user` branch fires
`window.onAuthReady(user)`, add: if `window.TeamManager?.syncFromCloud`, call
it. `onAuthReady` already runs after appShell is shown, so the UI is ready to
repaint.

Concern: avoid blocking the first-team prompt before sync completes.
**Mitigation:** the first-team prompt is gated on `loadTeams().length === 0`.
On a new device, that's true at first paint but becomes false after the cloud
pull. We need to delay the "ask for first team" UI until after sync completes
(or fails). Plan: in `js/app.js`, find the first-team prompt trigger and gate
it on `localStorage.getItem(CLOUD_SYNCED_KEY) === '1' || !getAuthUserId()`.

I'll grep for that prompt location during implementation — it's the modal that
opens when Jamie reported "asking me to input a first team."

---

## Step 5 — `js/app.js` touch points

Three changes:

1. **Defensive fallback at line 3378 (`getTeamManager()`):** that block
   recreates a localStorage-only TeamManager if teams.js didn't load. It needs
   to keep working unchanged, but won't have cloud sync. That's acceptable —
   it's defensive code for "teams.js failed to load," in which case the rest
   of the app is broken anyway.

2. **First-team prompt gating** — as described in Step 4.

3. **Team manager modal repaint** — when `syncFromCloud()` completes and the
   modal is open, repaint it. Add a `window.refreshTeamUI` function that the
   modal-render code can set when it opens and clear when it closes. The sync
   call hits this if present.

---

## Step 6 — Migration / first-sync flow walkthroughs

**Scenario A: Jamie's Mac (has teams in localStorage, just got this update).**

1. Page loads. localStorage has 3 teams.
2. Firebase auth resolves with existing user.
3. `syncFromCloud()` runs. Cloud returns `[]` (nothing pushed yet).
4. Local cache has 3 teams, cloud has 0. Per Step 3, we keep local teams and
   push each one up via `pushTeam()`.
5. Subsequent reads from any device return all 3 teams with their existing ids.

**Scenario B: Jamie's iPhone (fresh install, no localStorage teams, signed in).**

1. Page loads. localStorage is empty.
2. Firebase auth resolves with same user.
3. `syncFromCloud()` runs. Cloud returns 3 teams (pushed by Mac in Scenario A).
4. localStorage is populated with the 3 teams.
5. App repaints. First-team prompt does NOT fire because there are now teams.
6. iPhone is now consistent with Mac.

**Scenario C: Both devices online, edit on Mac (rename a team).**

1. Mac calls `updateTeam(id, {name: 'New Name'})`. localStorage updates, push
   fires.
2. iPhone won't see the change until either: page reload, or we add a polling
   mechanism (out of scope for this pass).
3. Acceptable for now — single-coach use case, rare to be on two devices at once.
4. If iPhone edits the same team in the meantime, last-write-wins by
   `updated_at`. We can add conflict UX later if it ever matters.

**Scenario D: Network is down on iPhone.**

1. Page loads. localStorage empty.
2. Firebase auth resolves (cached token).
3. `syncFromCloud()` fails (network). Returns gracefully.
4. App shows "Teams couldn't sync" toast.
5. App falls back to "no teams yet" state — first-team prompt fires. Not ideal
   but matches today's offline experience. User can dismiss, come back online,
   reload, teams appear.

**Scenario E: Guest user.**

1. No auth. `syncFromCloud()` returns immediately, doesn't touch cache.
2. Existing behavior preserved exactly.

---

## Step 7 — Failure modes & safety

| Failure | Behavior | Risk |
|---------|----------|------|
| Cloud GET fails on sync | Use localStorage, show toast | Low — cached data still works |
| Cloud PUT fails on push | localStorage already updated, log warning | Low — next push will re-send latest state |
| Cloud DELETE fails | localStorage already deleted, log warning | Medium — team may resurrect on next device unless retried |
| Race: two devices edit same team | Last-write-wins by updated_at | Low — single-user scenario |
| Schema migration error on Jamie's Supabase | API returns 500 | High — would re-orphan teams. Mitigation: run schema DDL and verify before deploying app code |
| Bad data shape in cloud row | Frontend filters invalid entries silently | Low |

**Mitigation for DELETE failure:** add a `pendingDeletes` localStorage queue
that retries on next sync. Out of scope for v1; flag as a follow-up.

---

## Step 8 — Order of work (one commit per step)

1. **Schema:** Jamie runs DDL in Supabase. Verify with `select * from teams`.
2. **API endpoint:** add `api/teams.js`. Deploy via push. Smoke-test with curl.
3. **teams.js cloud layer:** add `cloudFetch`, `syncFromCloud`, `pushTeam`,
   `pushDelete`. Wire into existing create/update/delete. Don't trigger sync
   yet (no auth hook). Push & deploy — no behavior change at this point.
4. **Auth hook:** call `syncFromCloud()` from `onAuthReady`. First-team prompt
   gate. Push & deploy. **This is the moment Jamie's Mac uploads its 3 teams.**
5. **Verify:** Mac uploads, iPhone pulls, both show same teams.
6. **Polish:** add toast on sync failure, refreshTeamUI hook, etc.

Each step is independently deployable and reversible. If step 4 breaks
something, we can revert just that commit and the cloud table sits idle without
affecting anyone.

---

## Step 9 — Testing plan

After step 4 deploys:

- [ ] Mac: log in. Check Supabase Table Editor → `teams` table → should have
      3 rows for Jamie's user_id.
- [ ] Mac: create a 4th test team. Verify a 4th row appears in Supabase.
- [ ] Mac: rename a team. Verify Supabase row updates.
- [ ] Mac: delete the test team. Verify the row is gone in Supabase.
- [ ] iPhone: log in (clear cache first to simulate fresh device). Verify all
      3 teams appear, with the same ids as Mac.
- [ ] iPhone: tap Past Games — verify games show under each team.
- [ ] iPhone: log out → sign in as guest. Verify guest mode still works
      (localStorage only, no cloud calls).
- [ ] Offline test: Mac in airplane mode. Reload. Verify cached teams still
      show, no JS errors, "Teams couldn't sync" toast appears once.

---

## Step 10 — What we explicitly do NOT touch

- Games table or `/api/games` endpoint.
- Active team selection logic — stays local per device.
- Roster save format inside team — same JSON shape.
- Team id format — keep the existing `t_xxx` ids so existing games are
  automatically associated correctly post-sync.
- Spectator mode, save-game, undo, scoring — all unchanged.
- Subscription scaffolding — left alone (project rule).

---

## Open questions for Jamie

1. After this is live, do you want me to also rebuild the Select roster from
   past game data (separate task)?
2. Anything in your current localStorage on the Mac that I should worry about
   before we sync up? E.g. teams you don't want pushed.
