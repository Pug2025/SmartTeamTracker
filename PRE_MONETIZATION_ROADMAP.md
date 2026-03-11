# Pre-Monetization Roadmap

Comprehensive improvement plan based on the full product quality audit. Covers trust, security, UX polish, consistency, and infrastructure changes needed before charging users.

Items from the existing `ROADMAP.md` (UX Round 4) are incorporated where relevant and cross-referenced rather than duplicated. The `SCORING_ROADMAP.md` changes are already implemented in the codebase.

---

## PHASE 1 — Trust & Score Credibility

The scoring system is the app's primary differentiator. If users don't understand or believe the scores, the entire value proposition collapses. This phase makes scores trustworthy.

### 1A. Score Ring: Make "/100" Explicit on Tap

**Problem:** Goalie and Team score rings display a number (e.g. "71") with no scale indicator. Users must infer this is out of 100. The ring color coding (green >= 80, orange >= 63, red < 63) helps, but a number without an explicit scale is ambiguous.

**Current behaviour:** Tapping the rings on the live game screen does nothing.

**Proposed change:** Add a tap handler on each score ring in the live game screen. On tap, show a brief inline tooltip or expand the ring label to display the score band:

- 80-100: Excellent
- 63-79: Solid
- 45-62: Below Average
- 0-44: Poor

Include a one-line note: "Based on [X] shots" for goalie, "Based on [X] total shots" for team. When confidence dampening is active (goalie shots < 20), append: "Score is moderated — more shots will sharpen the rating."

**Files:** `js/app.js` (add click handler on `#goalieScoreRing` / `#teamScoreRing` wrappers), `css/styles.css` (tooltip/expand styling).

**No grade letters.** The "/100" context plus color bands is sufficient.

### 1B. Summary Screen: Tap-to-Expand Score Breakdown

**Problem:** The summary screen shows Goalie and Team score rings with component bars below them, but there is no explanation of what the components mean or how the total is calculated. "GSAx" appears as a bar label (`js/app.js:2178`) — this is NHL analytics jargon that youth hockey coaches won't know.

**Proposed change:**
- Rename the "GSAx" bar label to "Save Quality" in the summary rendering. Keep the sub-line that says "+X.X goals saved above expected" as-is (it's good plain-language explanation).
- Add a small "How is this scored?" link below each score ring in the summary. On tap, expand an inline panel explaining the components in plain language:
  - **Goalie Score:** "Combines save percentage adjusted for shot difficulty, big saves, rebound control, and soft goals. Context matters — breakaway and screen goals are weighted less against the goalie."
  - **Team Score:** "Combines five areas: Result (25%), Possession (20%), Danger Control (20%), Shot Quality (20%), and Discipline (15%)."

**Files:** `js/app.js` (in `renderSummaryScreen()`, line ~2178 for GSAx rename, add expandable panel HTML), `css/styles.css` (expand/collapse styling).

### 1C. Update Help Modal: Fix Stale Score Weights

**Problem:** The Help modal (`index.html:758-763`) documents team score weights as "Shot Quality (15%), Result (35%), Discipline (10%)" — these are the **old** values. The code (`js/app.js:1758`) now uses Quality 20%, Result 25%, Discipline 15%.

**Proposed change:** Update the Help modal text to match the current code:

- Possession (20%)
- Danger Control (20%)
- Shot Quality (20%) — "Are your chances higher quality per shot than theirs"
- Result (25%) — "Weighted goal differential (PP goals discounted, SH goals bonused)"
- Discipline (15%) — "Penalties drawn vs penalties taken"

**Files:** `index.html` (lines 758-763).

### 1D. Confidence Dampening Indicator

**Problem:** The goalie score silently regresses toward 63 when shots are below 20 (`js/app.js:1680`). A shutout on 8 shots yields ~75 instead of ~95. Without explanation, this looks like a bug and will be the #1 "your app is broken" complaint.

**Proposed change:** When confidence < 1.0 (shots < 20), show a subtle indicator near the goalie score ring — a small text label like "Low volume — [X] shots" in muted color. In the summary breakdown, add a note: "Score moderated: only [X] shots faced. 20+ shots for full confidence."

**Files:** `js/app.js` (in `updateMeta()` and `renderSummaryScreen()`), `css/styles.css`.

### 1E. Acknowledge Subjectivity of Manual Tags

**Problem:** Soft goals, big saves, and high-danger tags are subjective coach inputs that directly affect scoring. This is by design and working correctly, but users may wonder about it.

**Proposed change:** Add a brief note in the Help modal under the scoring section: "Some inputs — like Soft Goal, Big Save, and High Danger — are your judgment calls as coach. The scoring model trusts your observations. There's no benefit to over- or under-tagging, so just call what you see."

**Files:** `index.html` (Help modal content).

---

## PHASE 2 — Security & Data Integrity

Non-negotiable before accepting payment. Users paying for a product expect their data to be safe.

### 2A. Server-Side Firebase Token Verification

**Problem:** All API endpoints trust `user_id` sent from the client (`js/app.js:2454`). No server-side verification of Firebase auth tokens. Any API caller can impersonate any user — reading, writing, or deleting their games.

**Proposed change:** On every authenticated write/delete endpoint (`/api/save-game`, `/api/games DELETE`, `/api/opponents DELETE`, `/api/live-game PUT/DELETE`):
- Require a Firebase ID token in the `Authorization: Bearer <token>` header.
- Verify the token server-side using the Firebase Admin SDK.
- Extract `uid` from the verified token instead of trusting the client-supplied `user_id`.
- Reject requests with invalid or missing tokens (401).

**Files:** All files in `/api/` directory. Add a shared auth verification utility.

### 2B. Replace Math.random() with Crypto-Safe Randomness

**Problem:** Game IDs use `Math.random().toString(36).slice(2)` (`js/app.js:304, 2430`). Share codes use `Math.random()` in a loop (`js/app.js:5022`). `Math.random()` is not cryptographically secure. Share codes are 6 characters from a 31-character alphabet — only ~4.6 billion combinations, feasibly enumerable.

**Proposed change:**
- Replace game ID generation with `crypto.randomUUID()` (supported in all modern browsers and Node 19+).
- Replace share code generation with `crypto.getRandomValues()`. Consider increasing share code length from 6 to 8 characters for better collision resistance.

**Files:** `js/app.js` (lines 304, 2430, 5019-5023).

### 2C. Add Rate Limiting to API Endpoints

**Problem:** No rate limiting on any endpoint. A malicious actor could spam `/api/save-game` or enumerate share codes via `/api/live-game?code=...`.

**Proposed change:** Add rate limiting middleware. Suggested limits:
- `/api/save-game`: 10 requests/minute per user
- `/api/live-game` PUT: 30 requests/minute per user (frequent live updates)
- `/api/live-game` GET: 60 requests/minute per IP (spectator polling)
- `/api/games` DELETE: 5 requests/minute per user
- `/api/opponents`: 20 requests/minute per user

**Files:** All files in `/api/`. Consider a shared rate-limit utility or Vercel/platform-level config.

### 2D. localStorage Quota Management

**Problem:** The app stores full game state, teams, roster, preferences, and an offline queue in localStorage. No size checking or cleanup. localStorage is limited to ~5MB; a heavy game with many events plus an offline queue could silently fail.

**Proposed change:**
- Before each `save()`, check remaining localStorage quota (try/catch the setItem or estimate size).
- If approaching the limit (>80% usage), show a warning toast.
- Add a cleanup mechanism for the offline queue: auto-remove successfully synced games.
- In extreme cases, prioritize saving the current game state over old queue items.

**Files:** `js/app.js` (in `save()` function and `saveOfflineQueue()`).

---

## PHASE 3 — Brand Consistency

Every inconsistency signals "not a real product." This phase takes 30 minutes and removes a permanent credibility drag.

### 3A. Unify Product Name

**Problem:** The app uses two names:
- "Team Tracker": auth screen (`index.html:26`), manifest (`manifest.json:3-4`), Help modal title (`index.html:676`), in-app header
- "Smart Team Tracker": HTML `<title>` (`index.html:17`), `<meta>` description (`index.html:9`), og:title (`index.html:11`), twitter:title (`index.html:15`)

**Proposed change:** Pick one name. Recommendation: use **"Smart Team Tracker"** as the formal product name (it's more distinctive and trademarkable). Update:
- `manifest.json`: name and short_name to "Smart Team Tracker"
- `index.html:26`: auth-logo text
- `index.html:676`: Help modal title
- In-app header text (if dynamically set)

Alternatively, if "Team Tracker" is preferred for brevity, update the HTML title and all meta tags to match.

**Files:** `manifest.json`, `index.html` (lines 9, 11, 15, 17, 26, 676).

### 3B. Remove "iPhone-optimized" from Manifest Description

**Problem:** `manifest.json:5` says "iPhone-optimized rink-side tracker." This alienates Android users (a significant portion of the market) and sounds like a developer note, not a product description.

**Proposed change:** Replace with: "Rink-side stat tracking for hockey coaches. Track shots, goals, saves, and more — live from the bench."

**Files:** `manifest.json` (line 5).

### 3C. Unify Terminology Across Screens

**Problem:** The same concepts use different names in different contexts:

| Concept | Button Label | Dashboard Tile | Summary Tile | Period Table | Help Text |
|---------|-------------|---------------|-------------|-------------|-----------|
| DZ Turnover | DZ Turnover | DZ TO | D-Zone TO | DZ TO | DZ Turnover |
| Odd Man Rush | Odd-Man Rush / Odd Man Rush | OMR For / OMR Ag | Odd Man Rush | OMR For / OMR Ag | Odd-Man Rush / Odd Man Rush |
| Breakaway Against | Breakaway | BA Ag | Breakaways Ag | BA Ag | Breakaway |
| Penalties | Their Penalty / Our Penalty | Pen For / Pen Ag | Penalties Drawn / Penalties Taken | Pen For / Pen Ag | Their Penalty / Our Penalty |

**Proposed change:** Create a consistent terminology map:
- Full form (buttons, summary, help): "DZ Turnover", "Odd-Man Rush" (with hyphen), "Breakaway", "Penalties Drawn" / "Penalties Taken"
- Abbreviated form (dashboard tiles, period table): "DZ TO", "OMR", "BA", "Pen"
- Always use "Against" / "For" suffixes consistently (not "Ag" in some places and "Against" in others). In compact contexts, "Ag" is acceptable — just use it everywhere compact, not inconsistently.

**Files:** `index.html` (button labels, dashboard tiles, summary sections), `js/app.js` (dynamic tile/table generation in `renderSummaryScreen()`).

### 3D. History List Score Labels

**Problem:** The history/past games list shows scores as `GK:63 TM:50` — extremely compressed, with non-standard abbreviations. "GK" and "TM" are not used anywhere else in the app.

**Proposed change:** Use "Goalie: 63 · Team: 50" or show scores as small color-coded badges consistent with the ring colors used elsewhere.

**Files:** `js/app.js` (in `renderHistoryList()` or equivalent function).

---

## PHASE 4 — UX Polish & Interaction Quality

These changes bridge the gap between "functional tool" and "product worth paying for."

### 4A. Button Visual Hierarchy (from existing ROADMAP 1A)

**Problem:** 14 buttons visible at once, all at roughly equal visual weight. Primary actions (Shot/Goal) don't stand out enough from context buttons in rink conditions.

**Proposed change:** Increase visual distinction between primary and context buttons via shadow depth, brightness, and border opacity adjustments. Context buttons remain fully visible and accessible — no hiding behind toggles.

Specific CSS changes as documented in `ROADMAP.md` Phase 1A.

**Files:** `css/styles.css`.

### 4B. Roster Management UI

**Problem:** The roster modal (`index.html:524-531`) uses a plain `<textarea>` with "one # per line" instructions. This is the clearest "developer tool" artifact in the product. Every coach interacts with the roster, and every coach forms an impression from it.

**Proposed change:** Replace the textarea with a proper roster management interface:
- List of player entries, each showing the jersey number
- "Add Player" button that appends a new entry (number input field)
- Tap-to-remove on each player entry (with confirmation)
- Numbers-only input with auto-sort

**Privacy constraint (minors):** Roster entries are jersey numbers only — no names, no personal information. This is already the current behavior; the new UI must maintain this constraint. Do not add name fields. If names are ever considered in the future, this would require a full privacy review (COPPA, parental consent, data encryption, right to deletion).

The textarea can remain as a hidden "bulk import" option for coaches migrating large rosters.

**Files:** `index.html` (roster modal markup), `js/app.js` (roster modal handlers), `css/styles.css` (roster list styling).

### 4C. Feature Pill Styling for History/Stats Links (from existing ROADMAP 1C)

**Problem:** "Past Games," "Season Stats," and "Player Stats" links look like footnotes, not features. These represent the app's long-term value — the exact thing that justifies a subscription.

**Proposed change:** Restyle as pill buttons with subtle borders and backgrounds, as documented in `ROADMAP.md` Phase 1C.

**Files:** `css/styles.css`.

### 4D. Setup Flow: Hide Redundant CTA (from existing ROADMAP 2A)

**Problem:** When no team exists, both the "Team Required" chip and the disabled "Add Team to Start" button say the same thing.

**Proposed change:** When no team exists, hide `btnStartGame` entirely and let the "Add Your Team" card be the sole call-to-action.

**Files:** `js/app.js` (in `updateSetupReadiness()`).

### 4E. Setup Flow: Matchup Card Transition (from existing ROADMAP 2B)

**Problem:** Matchup card appearance causes layout shift.

**Proposed change:** Use CSS max-height transition instead of display:none toggle.

**Files:** `css/styles.css`.

### 4F. Setup Flow: Move +/- Toggle Below Start Game (from existing ROADMAP 2C)

**Problem:** The Track +/- toggle creates a speed bump between form fields and the Start Game button for coaches who don't use this feature.

**Proposed change:** Relocate below the Start Game button under an "Options" label.

**Files:** `index.html`.

### 4G. Context Label Visibility (from existing ROADMAP 2D)

**Problem:** "Defensive Context" and "Offensive Context" labels are 9px at 0.6 opacity — invisible at the rink.

**Proposed change:** Increase to 10px at 0.8 opacity with a subtle bottom border.

**Files:** `css/styles.css`.

### 4H. Next Period Button Distinction (from existing ROADMAP 2E)

**Problem:** Next Period button blends into the dashboard.

**Proposed change:** Warm-tone styling (amber border, warm background tint) to distinguish it as a transition action.

**Files:** `css/styles.css`.

### 4I. Summary Screen: Extract Inline Styles to CSS Classes

**Problem:** `renderSummaryScreen()` (`js/app.js:2133-2386`) generates HTML with repeated inline styles like `style="font-size:11px; color:var(--muted); text-align:right; margin:-2px 0 6px 0;"`. This creates inconsistency (same concept styled slightly differently each time) and is harder to maintain.

**Proposed change:** Extract repeated inline style patterns into named CSS classes:
- `.comp-annotation` — the small muted text below component bars
- `.comp-annotation-warn` — red variant for soft goal warnings
- `.breakdown-card` — the cards used in goal breakdown grids

**Files:** `js/app.js` (renderSummaryScreen), `css/styles.css`.

### 4J. Unify Score Color Thresholds

**Problem:** The score ring colors use thresholds `>=80 green, >=63 orange, <63 red` (`js/app.js:1872`). The summary component bar colors use `>=60 green, >=40 orange, <40 red` (`js/app.js:2159`). A team component score of 55 would show orange in the summary but red if it were a ring.

**Proposed change:** Decide whether component bars should use the same thresholds as rings, or intentionally different ones (since components are sub-scores with different distributions). If intentionally different, document why. If unintentional, unify to the ring thresholds.

Recommendation: keep different thresholds but use a slightly different visual treatment (e.g., component bars use pastel variants of the same hues) so that the difference feels intentional rather than inconsistent.

**Files:** `js/app.js` (teamColor/gkColor functions in renderSummaryScreen).

---

## PHASE 5 — Spectator & Live Sharing Polish

The live spectator feature is a monetization differentiator. These changes ensure it feels premium.

### 5A. KPI Axis Labels (from existing ROADMAP 2F)

**Problem:** Spectator KPI cards show split values like "12-8" without indicating which number is which team.

**Proposed change:** Add "T - U" micro-labels to KPI card headers.

**Files:** `index.html` (spec-kpi-card elements), `css/styles.css`.

### 5B. Stale Feed Warning (from existing ROADMAP 2G)

**Problem:** Parents staring at an unchanging spectator screen don't know if the game is quiet or the feed is broken.

**Proposed change:** After 30 seconds without an update, subtly change the meta line color to amber. Resets on next update.

**Files:** `js/spectator.js`, `css/styles.css`.

### 5C. "Just Joined" Context Card (from existing ROADMAP 3B)

**Problem:** A spectator joining mid-game sees raw numbers with no context about how the game is going.

**Proposed change:** Show a dismissible context card on first data render: "P2 · Up 3-1 · 14-8 shots · SV% .917". Auto-dismisses after 8 seconds.

**Files:** `js/spectator.js`, `css/styles.css`.

### 5D. Game Feed Start Anchor (from existing ROADMAP 4D)

**Problem:** The event feed in spectator mode has no bottom boundary — it just ends.

**Proposed change:** Append a "Game started at [time]" anchor at the bottom of the feed.

**Files:** `js/spectator.js`, `css/styles.css`.

---

## PHASE 6 — New Features & Experience

Experiential improvements that make the app feel alive and worth paying for.

### 6A. Period-End Flash Summary (from existing ROADMAP 3A)

**Trigger:** Coach taps Next Period.

**Visual:** A card overlays the top of the game controls for 4 seconds showing the completed period stats: shots, goals, SV%. Auto-dismisses or tap to dismiss.

**Files:** `js/app.js`, `css/styles.css`.

### 6B. Haptic Patterns for Goals (from existing ROADMAP 3C)

**Problem:** All events produce the same single-tap haptic. Goals should feel distinct.

**Proposed change:** Goal For: double-tap pattern `[40, 60, 40]`. Goal Against: single longer pulse `[80]`.

**Files:** `js/app.js` (HAPTIC constant and goal handlers).

### 6C. First-Game Onboarding

**Problem:** The welcome modal (`index.html:617-671`) is a one-time overlay that explains the two-column layout at a high level. After dismissal, a coach faces 14 buttons with no further guidance. The Help modal exists but requires a menu tap to access.

**Proposed change:** After the welcome modal closes on first launch, show 2-3 brief inline coach marks (pulsing highlights) pointing at:
1. The Shot Against / Shot For buttons: "Start here — tap when a shot happens"
2. The score rings: "Live scores update as you track"
3. The Next Period button: "Tap between periods"

These should be non-blocking (tap anywhere to dismiss each one), fast (< 2 seconds each), and never shown again after first game. Store a `hasSeenOnboarding` flag in localStorage.

**Files:** `js/app.js` (onboarding logic), `css/styles.css` (coach mark styling), `index.html` if structural elements needed.

### 6D. Offline Queue Resilience

**Problem:** `flushOfflineQueue()` (`js/app.js:2501`) tries each queued game once. On failure, it stops. The `online` event waits 2 seconds and tries once. In flaky rink WiFi, the queue may never flush.

**Proposed change:**
- Implement retry with exponential backoff (3 attempts per game: 2s, 8s, 30s delays).
- Show queue status to users: "2 games pending sync" indicator near the cloud status.
- Add a manual "Retry Sync" button when queued games exist.
- On successful flush, show a toast confirming sync.

**Files:** `js/app.js` (flushOfflineQueue, cloud status UI).

---

## PHASE 7 — Account & Infrastructure

These are required for monetization but don't affect the core game-tracking experience.

### 7A. Account Settings Screen

**Problem:** No way to view account details, sign out with confirmation, or manage data. Signed-in users have no account presence in the app beyond the header showing their name.

**Proposed change:** Add an Account screen accessible from the menu:
- Display email and auth provider
- Sign out button with confirmation
- "Export All Data" option (download all games as JSON or CSV)
- "Delete Account" option with double-confirmation
- Cloud sync status (last sync time, queued items)

**Files:** `index.html` (account modal markup), `js/app.js` or new `js/account.js` (logic), `css/styles.css`.

### 7B. Guest-to-Account Migration

**Problem:** Guest users who try the app, track several games, and later want to create an account will lose all their localStorage data. These are exactly the users most likely to convert to paid — and they're punished for initial caution.

**Proposed change:** When a guest user signs up or signs in:
1. Check if localStorage contains game data (state, offline queue).
2. Prompt: "We found [X] saved games on this device. Import them to your account?"
3. On confirmation, upload localStorage games to the cloud with the new user_id.
4. Clear the guest localStorage data after successful migration.

**Files:** `js/auth.js` (migration trigger after sign-in), `js/app.js` (migration logic).

### 7C. Pricing & Paywall Infrastructure

**Problem:** No pricing, plans, upgrade prompts, or value messaging anywhere. The app doesn't know it's a paid product.

**Proposed change:** This is a design + business decision that requires choosing:
- Monetization model (freemium, free trial, subscription, one-time purchase)
- Feature boundaries (what's free vs paid)
- Payment provider (Stripe, RevenueCat, etc.)

At minimum, before monetization:
- Add a pricing display in the app (even if all features are currently free)
- Add a subscription status indicator
- Identify natural "upgrade prompt" moments (after first game saved, when live share is used, when viewing season stats)
- Build the payment integration

**Note:** This is the largest item and should be planned as its own workstream.

**Files:** New files for pricing UI, payment integration, subscription management.

---

## PHASE 8 — Fit & Finish

Low-priority polish that elevates perceived quality. Can be done before or after monetization.

### 8A. FAB Ring Color (from existing ROADMAP 4A)

**Proposed change:** Change `.fab-undo` border from `var(--gray-500)` to `rgba(77,163,255,0.2)`.

**Files:** `css/styles.css`.

### 8B. Calendar Icon on Date Field (from existing ROADMAP 4B)

**Proposed change:** Add an inline SVG calendar icon inside `.setup-date-shell`.

**Files:** `index.html`, `css/styles.css`.

### 8C. Spectator Text Truncation on Narrow Screens (from existing ROADMAP 4C)

**Proposed change:** Add `text-overflow: ellipsis` on insight text at `@media (max-width: 400px)`.

**Files:** `css/styles.css`.

### 8D. "Missed Chance" Button Label Shortening

**Problem:** "Missed Chance (No Shot)" is ~20 characters on a small touch target. The "(No Shot)" clarification is helpful but verbose for a repeatedly-tapped button.

**Proposed change:** Shorten button text to "Missed Chance". The "(No Shot)" clarification already exists in the Help modal.

**Files:** `index.html` (button labels in both columns).

### 8E. Summary Screen: Use Team/Opponent Names

**Problem:** The summary score labels (`index.html:414`) say "Them" and "Us" generically. The header shows actual team/opponent names.

**Proposed change:** Replace "Them" / "Us" labels with the actual opponent name and team name from the game state.

**Files:** `js/app.js` (in `renderSummaryScreen()`), `index.html` (if static labels need to become dynamic).

---

## Priority Summary

### Must Fix Before Monetization

| # | Item | Phase | Effort | Nature |
|---|------|-------|--------|--------|
| 1 | Fix stale Help modal score weights | 1C | Tiny | HTML text edit |
| 2 | Rename "GSAx" to "Save Quality" in summary | 1B | Tiny | JS string change |
| 3 | Unify product name everywhere | 3A | Small | Multi-file text edits |
| 4 | Remove "iPhone-optimized" from manifest | 3B | Tiny | JSON text edit |
| 5 | Server-side Firebase token verification | 2A | Medium | All API files |
| 6 | Replace Math.random with crypto | 2B | Small | JS changes |
| 7 | Score ring tap-to-explain | 1A | Medium | JS + CSS |
| 8 | Confidence dampening indicator | 1D | Small | JS + CSS |
| 9 | Acknowledge subjective tags in Help | 1E | Tiny | HTML text |
| 10 | Roster management UI | 4B | Medium | HTML + JS + CSS |
| 11 | Account settings (basic) | 7A | Medium | New screen |
| 12 | Guest-to-account migration | 7B | Medium | JS auth flow |

### Should Fix Soon After Monetization

| # | Item | Phase | Effort | Nature |
|---|------|-------|--------|--------|
| 13 | Terminology consistency cleanup | 3C | Medium | Multi-file text edits |
| 14 | History list score labels | 3D | Small | JS string change |
| 15 | Button visual hierarchy | 4A | Small | CSS only |
| 16 | Feature pill styling | 4C | Small | CSS only |
| 17 | Setup flow improvements (4D-4F) | 4D-4F | Small | HTML + JS + CSS |
| 18 | Context label visibility | 4G | Tiny | CSS only |
| 19 | Next Period button distinction | 4H | Tiny | CSS only |
| 20 | Extract summary inline styles | 4I | Medium | JS + CSS |
| 21 | Unify score color thresholds | 4J | Small | JS |
| 22 | API rate limiting | 2C | Medium | API files |
| 23 | localStorage quota management | 2D | Small | JS |
| 24 | Spectator axis labels | 5A | Small | HTML + CSS |
| 25 | Stale feed warning | 5B | Small | JS + CSS |
| 26 | First-game onboarding | 6C | Medium | JS + CSS |
| 27 | Offline queue resilience | 6D | Medium | JS |

### Nice-to-Have Polish

| # | Item | Phase | Effort | Nature |
|---|------|-------|--------|--------|
| 28 | Period-end flash summary | 6A | Small | JS + CSS |
| 29 | Haptic patterns for goals | 6B | Tiny | JS |
| 30 | "Just joined" spectator card | 5C | Small | JS + CSS |
| 31 | Game feed start anchor | 5D | Tiny | JS + CSS |
| 32 | FAB ring color | 8A | Tiny | CSS |
| 33 | Calendar icon | 8B | Tiny | HTML + CSS |
| 34 | Spectator text truncation | 8C | Tiny | CSS |
| 35 | "Missed Chance" label shortening | 8D | Tiny | HTML |
| 36 | Summary team/opponent names | 8E | Small | JS |

---

## Recommended Implementation Order

**Sprint 1 — Quick Wins (items 1-6, 9):** Fix all text/naming inconsistencies, security foundations. These are small edits with outsized trust impact.

**Sprint 2 — Score Trust (items 7-8):** Make scores explainable and credible. This is the highest-ROI feature work.

**Sprint 3 — UX Core (items 10, 15-19):** Roster UI, button hierarchy, setup flow. Visible quality improvements.

**Sprint 4 — Infrastructure (items 11-12, 22-23):** Account management, auth security completion, data resilience.

**Sprint 5 — Consistency & Polish (items 13-14, 20-21, 24-27):** Terminology cleanup, visual consistency, spectator polish, onboarding.

**Sprint 6 — Experience (items 28-36):** Period summaries, haptics, fit & finish.

**Sprint 7 — Monetization (item from 7C):** Pricing, paywall, payment integration — planned as own workstream after product is polished.
