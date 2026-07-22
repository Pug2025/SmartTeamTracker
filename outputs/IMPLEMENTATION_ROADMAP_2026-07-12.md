# Smart Team Tracker — Master Implementation Roadmap

**Date:** July 12, 2026 · **Basis:** Pre-Monetization Audit (2026-07-11) + approved "Ice" design study (`Spectator Ice.html`, rendered and reviewed 2026-07-12)

**Decisions locked by Jamie (2026-07-12):**
1. **Ice design language adopted app-wide** — teal accent `#17B6C8`, five-token palette, Saira Semi Condensed + Hanken Grotesk. Old palette retired during migration.
2. **Parent-side premium** monetization model — live share stays free (growth loop); parents/family pay for depth (history, recaps, per-goalie analytics, share cards).
3. **Hardening first** — Phase 0 ships before any visual work.
4. **Brand assets** produced by Jamie in GPT 5.6 per the request list in §Assets; delivered to `outputs/brand/`; Claude generates placeholders wherever an asset hasn't arrived so no phase blocks.

**Conventions for every phase:** one commit per numbered task, commit message `P{phase}.{task}: {summary}`. Jamie pushes from GitHub Desktop (Claude commits only). Line numbers below were verified at commit `819bda7`; if code has moved, locate by the grep hints given per task. Each task lists **Files / Change / Accept** (acceptance test). Effort: S < 1h, M = half-day, L = day+.

---

## Phase overview

| Phase | Theme | Gate | Effort |
|---|---|---|---|
| 0 | Hardening: data-integrity, trust, install | ✅ DONE 2026-07-12 (10 commits, verified) | ~2 days |
| 1 | Ice spectator reskin (payload prep + skin) | ✅ DONE 2026-07-12 (6 commits, verified, 2 loop rounds) | ~2 days |
| 2 | Ice token system app-wide (quiet variant) | ✅ DONE 2026-07-13 (9 commits, verified; Stage A 1 fix round, Stage B 0) | ~3–4 days |
| 3 | Brand asset integration | GPT 5.6 assets in `outputs/brand/` | ~1 day |
| 4 | Scoring/domain credibility | ✅ DONE 2026-07-13 (6 commits, verified independently; 0 fix rounds) | ~2 days |
| 5 | Rink-side UX polish | ✅ DONE 2026-07-14 (8 commits, verified; 0 fix rounds; 1 documented deviation) | ~2 days |
| 6 | Parent-side premium infrastructure | Phases 0–5 + pricing sign-off | own workstream |

---

## Phase 0 — Hardening sprint

### P0.1 Commit Goal For immediately; make every chain-abort explicit
**Files:** `js/app.js` (grep `for_goal_scorer`, `openGAContext`, the shared backdrop handler near line 4380).
**Current:** The Goal For event is only created inside the scorer-picker branch (`js/app.js:3362–3374`). Backdrop tap, Cancel, or reload during the scorer step silently discards the goal. The Goal Against context sheet's backdrop handler (`js/app.js:4381–4392`) nulls `lastGAEvent` while `openGAContext` has already set `needsContext=false` (`:1431`), so a backdrop tap saves the GA untagged AND skips the +/- and strength steps — with no feedback.
**Change:** (a) On Goal For tap, `addEvent('for_goal', …)` immediately with `scorer:'?'`; the picker chain then *enriches* the existing event (update scorer/assist/on-ice/strength in place). (b) Cancel/backdrop during any enrichment step keeps the committed goal, shows toast `Goal saved — details skipped. Tap to edit.` (c) GA context backdrop behaves exactly like the existing "Tag Later" button (sets `needsContext=true`, continues the chain). (d) Add a Cancel button to the GA context sheet that removes the just-committed GA event (with toast + Restore).
**Accept:** Tap Goal For → tap backdrop → score increments, event exists with scorer `?`, toast shown. Tap Goal Against → backdrop → GA exists flagged needs-context and +/-/strength prompts still fire. Reload mid-picker → goal survives.

### P0.2 Shared SV% formatter (kills the `.000` bug)
**Files:** `js/app.js` (call sites ~812, 2118, 2152, 2448, 2452, 2571–2572, 3114–3115, 4556–4557, 5631–5632, 6531–6532 — grep `toFixed(3).slice(1)` and `sv`), `js/spectator.js:654–658` (the correct reference implementation).
**Change:** Add one `fmtSvPct(saves, shots)` helper: returns `'—'` when `shots===0`, `'1.000'` when ratio ≥ 1, else `.XXX`. Replace every coach-side call site. Standardize the season dashboard's `91.2%` format (`js/app.js:6421, 6485`) to the same `.912` convention.
**Accept:** A shutout shows `1.000` in: live header sub-label, summary tile, BY GOALIE HD SV% column, season dashboard. Grep confirms zero remaining `toFixed(3).slice(1)`.

### P0.3 Guest re-entry: never show the marketing page over existing data
**Files:** `js/auth.js` (guest button handler ~line 216; `showAuthScreen` ~78), `js/app.js` (grep `guest`).
**Change:** When "Continue as Guest" is tapped, persist `localStorage['team-tracker-guest-mode']='1'`. In the unauthenticated branch of `onAuthStateChanged`, if that flag is set, call `hideAuthScreen()` + `window.onAuthReady(null)` instead of `showLandingPage()`. "Sign Out" (guest) and "Back to overview" clear the flag.
**Accept:** Continue as Guest → hard reload → app shell loads directly (no landing, no auth). Live game in progress → reload → live screen restored directly.

### P0.4 Init-gate the save path (live-game wipe race)
**Files:** `js/app.js` (`load()` at init ~3423, `save()`, `applyActiveTeam()` ~3918).
**Current:** `init()`'s `load()` is async (IndexedDB-first); `applyActiveTeam()` and auth-ready paths can call `save()` before `load()` resolves, overwriting a stored live game with default state. Observed once in audit (unreproducible; treat as race).
**Change:** Module flag `stateLoaded=false`, set true when `load()` resolves. `save()` returns early (console.warn) while `stateLoaded===false`. Additionally, if the in-memory state is pristine-default (`gameState==='setup' && events.length===0`) and storage contains a state with `gameState==='active'`, refuse the overwrite and reload from storage instead.
**Accept:** Add a temporary artificial 3s delay inside `load()`; reload during a live game; confirm no `save()` fires before load resolves and the game restores. Remove the delay.

### P0.5 "No Assist" button un-hidden
**Files:** `index.html:1078` (`#pickerNone` has class `hidden`), `js/app.js:3310` (`openPicker` sets `style.display`).
**Change:** Remove `hidden` from the element's class attribute; in `openPicker`, toggle via `classList.add/remove('hidden')` per the `showNone` option. Record `assist:null` (unassisted) when tapped — distinct from `'?'` (unknown).
**Accept:** Score a goal → assist step shows **No Assist**; choosing it stores `assist:null`; player stats credit no assist; "Unknown" still stores `'?'`.

### P0.6 Status toasts: synchronous show
**Files:** `js/app.js:771–781` (`showStatusToast`).
**Current:** `.show` is added inside `requestAnimationFrame` but removed via `setTimeout` — if the rAF defers (backgrounded tab), removal fires first and the deferred rAF re-adds `.show` permanently.
**Change:** Add the class synchronously (the CSS transition still runs), or token-guard: capture `const token=++toastSeq` and have the rAF callback no-op if `token!==toastSeq` or the hide timer already fired.
**Accept:** Trigger "Team added!", immediately background the tab 5s, foreground: toast gone. No toast survives >4s in any flow.

### P0.7 End Season modal stacking
**Files:** `js/app.js` End Season handler (~4080), `index.html` (`#endSeasonModal` precedes `#teamModal` in DOM, both z-index 9999).
**Change:** In the End Season button handler, close `#teamModal` before opening `#endSeasonModal`; on cancel, reopen the team manager. (Belt-and-braces: give `#endSeasonModal` z-index 10000.)
**Accept:** Manage Teams → End Season → modal is visible and interactive with suggested season name; Cancel returns to Manage Teams.

### P0.8 PWA icons + manifest (placeholder now, branded in Phase 3)
**Files:** new `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180), `favicon.ico`; `manifest.json`; `service-worker.js:20–22`; `index.html` head.
**Change:** Generate placeholder icons (flat `#0C1219` rounded square, "STT" in Saira 800, teal `#17B6C8`; maskable variant with content inside the 80% safe zone). Update `manifest.json`: real icon entries with `purpose:"any"` and `"maskable"`, `theme_color` `#0A0F18`, `background_color` `#05070C`. Add `<link rel="apple-touch-icon">` + favicon links. Bump SW cache version.
**Accept:** Lighthouse PWA installability passes; zero 404s in the network panel on cold load; Add-to-Home-Screen shows the icon on iOS and Android.

### P0.9 API: stop trusting client user_id
**Files:** `api/save-game/index.js:47` (`verifiedUserId = uid || game.user_id || null`), `api/games/index.js:22, 34`.
**Change:** When no verified token: force `user_id=null` on writes (ignore any client-supplied value) and on reads only allow `user_id is null` scoping. Verified callers keep token-derived uid.
**Accept:** `curl` POST with `game.user_id:"someone-else"` and no auth → stored row has `user_id:null`. GET with `?user_id=someone-else` and no auth → does not return that user's rows.

### P0.10 End Game confirm + landing glyph
**Files:** `js/app.js` End Game handler; `index.html:458`.
**Change:** (a) Confirm dialog on "End Game & Score": `End the game? P{n}, {them}–{us}. This saves the game to history.` (b) Replace `&#129945;` (U+1FB99 tofu) with an inline stroke SVG (goal-net or shield icon, stroke-width 2, matching the calendar SVG at `index.html:679`) — do not substitute another emoji.
**Accept:** End Game prompts before saving; landing "Real Goalie Evaluation" card shows a crisp icon on macOS and Windows.

---

## Phase 1 — Ice spectator reskin

**This section is self-contained: any model can execute it with only repo access.** The pixel source of truth is `design/spectator-ice.html` (move it there from repo root `Spectator Ice.html`; also move `rink-ice.png` → `assets/rink-ice.png`). All key values are also inlined below in case the file is absent.

### P1.0 Prep (files + asset)
1. `git mv "Spectator Ice.html" design/spectator-ice.html` and `git mv rink-ice.png assets/rink-ice.png` (create dirs).
2. Convert the rink image: `cwebp -q 80 assets/rink-ice.png -o assets/rink-ice.webp` (target ≤ 250 KB; source PNG is 682×1372, 2.0 MB — keep it as source). If `cwebp` is unavailable, use `sips`/ImageMagick to produce an optimized JPEG at quality 82 instead; same filename pattern.
3. In `design/spectator-ice.html`, note these are **mockup scaffolding — ignore them during implementation**: the `.badge-note` element, the demo needle `setInterval` script, the unused `--card` custom property, the empty `.rink` div.

### P1.1 Share payload carries team identity (small JS, separate commit)
**Files:** `js/app.js` (Share Live flow — grep `live-game` PUT / `shareCode`), `js/spectator.js` (~291–297 where the title is built and the US column is labeled `US`), `api/live-game/` (allowlist new fields if the endpoint validates payload shape).
**Change:** Add to the live payload: `teamName` (active team's name), `opponentName`, `level`. In spectator render: title becomes `{TEAMNAME} {LEVEL} · VS {OPPONENT}` (uppercase); the two column labels become the real short names; crest initials derived per: first letter of first two words of the name, else first two letters, uppercased (e.g. "Audit Wolves"→"AW", "Napanee"→"NA"). Fallback when fields absent (old payloads): current behavior ("US"/opponent).
**Accept:** Start a share; spectator page headlines the real team name and both crests show correct initials; an old-format payload still renders.

### P1.2 Ended state distinct from waiting
**Files:** `js/spectator.js` (ended handling gated at ~596–604; the "waiting" copy near `:53`).
**Change:** When the live row is gone/404 after data was seen, OR the payload carries an `ended:true` flag (add it when the coach taps Stop/End), render the ENDED state (styled in P1.3): pill "SHARING ENDED" (or "FINAL" when a final score is in the payload), momentum/quality frozen, feed retained. Never show "Waiting for coach…" once data has been seen.
**Accept:** Open share → coach ends game → within one poll the page shows FINAL/ENDED, not "waiting".

### P1.3 The reskin
**Scope rule:** every new rule is scoped under the spectator root (`#spectatorView` / `.spectator-view` — verify the actual root class in `index.html`, grep `spectator-view`). Coach-facing screens must be pixel-unchanged. No JS logic changes beyond class-name additions at render time. Do not rename or remove any element ID — `js/spectator.js` writes into them.

**(a) Fonts.** Add to `index.html` head (spectator route only is fine, global is acceptable):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Saira+Semi+Condensed:wght@700;800;900&family=Hanken+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
```
(Only these six weights — the mockup requests ten; trim.) Tokens: `--display:'Saira Semi Condensed',ui-sans-serif,sans-serif; --ui:'Hanken Grotesk',-apple-system,sans-serif`. Add both font CSS+woff2 URLs to the `service-worker.js` cache list; system fallbacks must keep the page fully usable offline/blocked.

**(b) Palette tokens (these are now the PRODUCT tokens — define once, reuse in Phase 2):**
```css
--us:#2F6FED; --them:#DB3B4B; --ice:#17B6C8; --win:#1FB880; --warn:#F4A627;
--ink:#EEF4FA; --muted:#C2CEDD; --muted2:#9DAABE; --line:rgba(255,255,255,0.16);
```

**(c) Background stack** on the spectator root: `url('assets/rink-ice.webp') center/cover no-repeat, #0A0F18`; page behind it `#05070C`. Overlays (all `position:absolute; inset:0; pointer-events:none`): `.frost` — the inline fractalNoise SVG data-URI from the design file, `opacity:.62; mix-blend-mode:multiply`; `.scrapes` — the three repeating-linear-gradients (64°/-58°/72°, rgba(90,125,160,.04–.05) hairlines at 26/34/90px spacing); `.topbloom` — 420×300 radial white glow at top center, `filter:blur(8px)`. Remove the existing `.spectator-bg-glow` element/rules. Add `<link rel="preload" as="image" href="assets/rink-ice.webp">` when `?live=` is present. **Performance gate:** test on a mid-tier Android (or 6× CPU throttle in DevTools) during 3s-poll updates; if frames drop, bake frost+scrapes into the image asset and delete those two live layers — final visuals must match either way. *(Update 2026-07-12: the bake-fallback asset now exists — `outputs/brand/ice-texture-master.png` (Canva, 4K) can be composited over `rink-ice.webp` offline to replace the live layers if the gate fails.)*

**(d) Layout — fixed stage, scaled.** `.stage{width:472px;height:950px;position:relative;overflow:hidden}` scaled as one unit: `scale = Math.min(vw/472, vh/950)` — measure with `visualViewport` (fallback `document.documentElement.clientWidth/Height`), re-run on `resize` and `visualViewport` events, NOT bare `window.innerHeight` (mobile URL-bar jumps). `transform-origin:center`. Content zone `.content{position:absolute;top:5.6%;bottom:6.4%;left:0;right:0;padding:0 18px;display:flex;flex-direction:column;justify-content:center;gap:11px}` (net-to-net on the rink image). Respect `env(safe-area-inset-top/bottom)` by insetting the stage container. Desktop letterbox: fill the void with the frost texture over `#05070C`, not flat black. **Type compensation:** at 375px the stage renders at 0.79× — adjust the design file's sizes so *effective* sizes are readable: design 13px→16px (feed rows), 12px→15px (quality text, LIVE pill), 11px→14px (team names, shots, card titles, meta), 10px→12px (axis labels, clock). Re-tune spacing by eye against `design/spectator-ice.html` after the bump.

**(e) Glass card recipe** (class `.glass`): `background:rgba(9,14,24,0.9)` (scoreboard variant `0.82`); `border:1px solid var(--line)`; `border-radius:22px`; `box-shadow:0 24px 54px rgba(6,12,22,.5), 0 2px 8px rgba(6,12,22,.3), inset 0 1px 0 rgba(255,255,255,.16)`; `::before` top highlight line (left/right 18px, 1px, white .45 gradient); `::after` skewed sheen (`105deg` white .10→.16 band, `skewX(-12deg)`, left -30%, width 60%). Text over glass gets `text-shadow:0 1px 3px rgba(0,0,0,.65)` (scores: `0 2px 12px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.5)`).

**(f) Hero scoreboard card** replaces the current `.spectator-header` + `.spectator-scoreboard` pair (this also fixes the audit's 375px scoreboard overflow at `css/styles.css:2722`): LIVE pill (gradient `#27D17C→#16A862`, text `#04210f`, letter-spacing 2.4px, pulsing 7px dot, `border-radius:999px`, shadow `0 8px 22px rgba(31,184,128,.4)`) → title (`--display` 700, uppercase, effective ≥18px) → hairline → 3-column grid `1fr auto 1fr`: THEM crest+name+score+shots | period pill (`--display` 700 22px + clock sub-line) | US crest+name+score+shots. Crests: 50×54, `border-radius:13px 13px 15px 15px`, `--display` 800 21px, top-edge white .4 highlight bar; THEM `linear-gradient(180deg,#3a4654,#262e3a)` color `#cdd6e2`; US `linear-gradient(180deg,#2a5fd6,#163a86)` color `#dce9ff` + glow `0 10px 28px rgba(47,111,237,.45)`. Scores: `--display` 900, 58px design size, `line-height:.82`, `letter-spacing:-1px`, `font-variant-numeric:tabular-nums`; THEM `#ff8088`, US `#7aacff`. Keep every existing ID (`specThemLabel`, score/shot line elements, etc.) inside the new markup, bound as before.

**(g) Momentum + Chance Quality card** (merged, momentum first): track 16px pill, gradient `90deg: rgba(219,59,75,.85) 0%, rgba(120,70,80,.5) 38%, rgba(40,55,75,.6) 50%, rgba(60,110,150,.5) 62%, rgba(23,182,200,.9) 100%`; white .6 midline; needle 6×22px `#36e0f0` with `0 0 16px rgba(54,224,240,1)` glow, `transition:left 1.2s cubic-bezier(.22,1,.36,1)` — keep the existing `specMomentumNeedle` `left:%` write. THEM/US axis labels beneath. Divider, then Chance Quality: 9px track `rgba(255,255,255,.12)`, fill from the 50% midline `linear-gradient(90deg,#36e0f0,#21d693)` + `0 0 14px rgba(54,224,240,.7)` glow — keep `specQualityFill` width semantics; status text `#8fefd2`. Card meta text (e.g. "Pushing") `#42d6e6`.
**Copy/logic fix while here:** `renderQuality` (`js/spectator.js:401–424`) gets the same minimum-sample guard `renderMomentum` has (`:459–461`): under 6 total shots render neutral copy ("Feeling each other out") and 50% fill.

**(h) Game Feed card:** title GAME FEED; rows: 22×22 rounded icon chip + text + right-aligned tabular time meta. Map existing event classes → four styles: goal-for (bg `linear-gradient(90deg,rgba(31,184,128,.16),transparent)`, text `#7ce0b6` 800, chip `rgba(31,184,128,.22)` ▲), goal-against (red equivalents, ▼), positive events (blue chip `rgba(47,111,237,.2)` ▸), saves (teal chip `rgba(23,182,200,.2)` ✓). **Copy fix:** opponent goals must render "Goal against" — never the celebratory "GOAL!" (`js/spectator.js:550–553`); our goals render "GOAL — {TeamName}". Fix "1 shots" pluralization. If the feed exceeds the stage, cap with internal scroll + bottom fade mask (visible affordance). Keep the "Game started at…" anchor row.

**(i) KPI grid + footer:** hide the 4-KPI grid visually (`display:none` in this skin) but leave elements/IDs in the DOM (spectator.js writes them). Footer: centered `Powered by SMART TEAM TRACKER` pinned near stage bottom — **deviation from mockup:** the brand name uses `#42d6e6` (not the illegible `#2a7a86`) with `text-shadow:0 1px 4px rgba(0,0,0,.7)`; if still weak over the crease, set the line on a slim glass chip. Do NOT delete `specStatus`/`specMetaLine` — their information moves into the state pill (j).

**(j) States — all four must be styled:**
- LIVE: green pill as designed.
- STALE (existing stale trigger — `js/spectator.js:353–362`; **change threshold from 120s to 30s** per PRE_MONETIZATION §5B): pill becomes `--warn` amber, text `LIVE · UPDATED {N} MIN AGO` (fold in the existing `specMetaLine` timestamp).
- WAITING (share exists, no data yet): neutral gray pill `STARTING SOON`, board renders 0–0 with crests.
- FINAL/ENDED (from P1.2): solid gray pill `FINAL` (score known) or `SHARING ENDED`; needle/quality frozen; feed retained.
- Keep existing goal-celebration + score-bump animations working over the skin. Wrap all decorative motion (pulse, sheen, needle glow transition) in `@media (prefers-reduced-motion: no-preference)`.

**(k) Link previews:** update `spectator-share.html` and `spectator-preview.svg` to the Ice look; fix the one-word "SmartTeamTracker" spelling in the SVG.

**(l) Verification checklist (run all):** `?live=` demo data drives score, needle, quality fill, feed; all four states reachable and visually distinct; goal celebration fires; 375×812 emulation — smallest text ≥12px effective, no horizontal clipping, footer legible; desktop pass (frost-filled letterbox); reload mid-share restores; offline/fonts-blocked still renders with system fonts; total transfer < 500 KB (fonts + WebP); coach-facing screens pixel-unchanged (spot-check live game + summary).

---

## Phase 2 — Ice tokens app-wide (the quiet variant)

Ordering within phase: 2.1 → 2.2 → (2.3–2.5 any order) → 2.6.

### P2.1 Token layer in `css/styles.css`
Replace the current `:root` block contents (`styles.css:3–40`) with the Ice system (keep old names aliased during migration, delete aliases in P2.6):
- **Palette:** the P1.3(b) tokens, plus surfaces `--surface-0:#05070C` (page) `--surface-1:#0C1219` (card) `--surface-2:#141C26` (nested) `--surface-3:#1D2733` (pressed/hover); single hairline `--line:rgba(159,178,205,0.14)`; semantic tints `--win-tint:rgba(31,184,128,.14)` `--warn-tint:rgba(244,166,39,.14)` `--them-tint:rgba(219,59,75,.12)` `--us-tint:rgba(47,111,237,.12)`.
- **Roles:** `--ice` is the ONLY brand/CTA/focus/link/toggle accent. `--us`/`--them` appear ONLY on team data (scores, zone tints, event rows). Score bands: keep thresholds 80/63 but recolor to `--win`/`--warn`/`--them`.
- **Type:** `--display`/`--ui` as Phase 1; scale tokens `--fs-11/12/13/15/17/20/24/32/44` (map every existing size to nearest; the audit found 21 sizes); weights limited to 400/600/700/800 (replace 780/820/910 at `styles.css:2792, 2957`); `font-variant-numeric:tabular-nums` on ALL numeric classes (scores, rings, tiles, tables — grep `score|stat|tile|val|num`).
- **Shape/motion:** radius tokens only — 8 (inputs/tiles), 12 (cards), 16 (modals), 22 (glass/hero), 999 (pills); three shadows `--shadow-1/2/3` + one focus ring (`0 0 0 3px rgba(23,182,200,.35)`); easing `--ease:cubic-bezier(.22,1,.36,1)`, durations 120/240/400ms.

### P2.2 Mechanical migration
Find/replace across `css/styles.css`, `css/auth.css`, inline styles in `index.html`, and JS-injected styles in `js/app.js` (`renderSummaryScreen` etc. — this absorbs audit item PRE 4I: extract repeated inline styles to classes `.comp-annotation`, `.comp-annotation-warn`, `.breakdown-card`). Retirement list (must hit zero occurrences): the four legacy greens (`#32d74b`, `#4caf50`, `#5ee07a`, spectator pastels `#5bd184/#49cb67/#7dd59a/#8be0a0/#9df0b0/#79d79b`), legacy blues (`#4da3ff`, `#8ebeff`, `#73adff`, `#4d8af0`, `#b5d6ff`, `#8fb8e0`, `#d8eaff`), legacy red `#ff453a`, all ~50 one-off near-blacks, the old spectator steel ramp (`#08111c/#060d16/#04080e`) and its Avenir Next stack (`styles.css:2675`). Target: ≤ 25 distinct color values repo-wide (audit baseline: 287). **Accept:** a grep-based color census script output pasted into the commit message; every screen visually spot-checked against a screenshot taken before migration (layout identical, only skin changes).

### P2.3 Icon system
Extend the existing stroke-SVG language (24-box, stroke-width 2, round caps — matches the calendar at `index.html:679`): replace the 6 remaining landing emoji, welcome-modal `●`/`✓` glyphs (`index.html:1512–1515`), feed `▲▼` arrows, hat-trick `🎩` (`js/app.js:1232` → trophy SVG). Zero emoji rendered anywhere. Placeholder wordmark: header + landing logo set in Saira 800 with the teal accent until the Phase 3 lockup arrives.

### P2.4 Coach-app quiet variant
Apply tokens WITHOUT live atmosphere effects: solid `--surface-*` fills (no blur, no blend modes on the coach path); nesting communicates via surface steps (modal `--surface-1` → section `--surface-2` → tile `--surface-3`) instead of same-elevation hairline cards. Live-game THEM/US zone tints re-derived from `--them-tint`/`--us-tint`. Summary rings/bars recolored to semantic tokens. Move the summary's **Delete Game** button out of the final position into a small overflow row ("⋯" or de-emphasized text link) — the money screen must not end on red.

**Ice-texture whisper background (asset delivered 2026-07-12, Canva-generated):** `outputs/brand/ice-texture-dark-1920.webp` — darkness pre-baked (navy `#080D16` base, texture lifts ~5–8%), so it renders as one static image with zero blend-mode/battery cost. Use as the page background on Setup, Past Games, Season, Player Stats, Account/Help (`background: url(assets/brand/ice-texture-dark-1920.webp) center/cover fixed, var(--surface-0)`), with solid cards on top. **Live game screen:** trial it behind the button grid at final opacity only if the verification pass confirms zero contrast loss on the 9px header stats and context labels; drop it from the live screen without debate if legibility flags. **Accept:** WCAG-ish spot checks — muted text (`--muted-ice`) over the textured background ≥ 4.5:1 at the texture's brightest point; verification agent screenshots each panel over the texture's lightest region.

### P2.5 Broadcast surfaces
Landing + auth restyled with tokens; landing gets the ice-texture treatment and a 2-column ≥900px hero (copy left, phone mockup right); post-game summary gets ONE restrained ice-texture header band behind the score headline (no full-photo background — it's a data screen).

**Ice-texture band variant (asset delivered 2026-07-12):** `outputs/brand/ice-texture-band-1920.webp` (visibly icy navy, pre-darkened) is the band asset. Use it for: (a) the summary score-headline band, (b) the season-header strip on the Season dashboard, (c) the **spectator desktop letterbox** — replace the procedural fractalNoise `.spectator-view::before` fill from P1.3(d) with this real texture, (d) landing section backdrops. The bright master (`ice-texture-light-1920.webp` / `ice-texture-master.png` 3840×2160) is reserved for share cards/og (P3.4, Phase 6).

### P2.6 Cleanup
Delete alias tokens, the old spectator CSS block (~`styles.css:2668–3140` where superseded), dead keyframes (audit found 29; target ≤ 18), and `calibration.html`/`spectator-preview.svg` from public serving if unused (`vercel.json` route check). Bump SW cache version.

---

## Phase 3 — Brand asset integration (gated on `outputs/brand/`)

For each delivered asset: copy into `assets/brand/`, then:
- **P3.1 Wordmark/lockup** → ✅ PARTIALLY DONE (commit 2b53e4a, 2026-07-12): Jamie's approved lockup (master art: `outputs/brand/lockup/lockup-master-transparent.png` + `-dark.png`; serving: `assets/brand/lockup-dark-640.webp`) is live on the landing hero and auth screen. Remaining: spectator footer (optional — text currently legible), share-card template (Phase 6). App-icon derivation from the blade deferred by Jamie ("later").
- **P3.2 App icons** → replace P0.8 placeholders (`icon-192/512/maskable/apple-touch/favicon`); regenerate `favicon.ico`; bump SW. DEFERRED per Jamie until a mark is chosen.
- **P3.3 Landing hero image** → desktop landing left-column art; compress to WebP ≤ 300 KB, `loading="lazy"` below fold. Candidate already on hand: `ice-texture-light-1920.webp` + lockup composite may suffice — evaluate before commissioning photography.
- **P3.4 Share/OG art** → ✅ ASSET DELIVERED (2026-07-12): `outputs/brand/ice-texture-light-1920.webp` (and 4K master) is the share/og background base — composite with `lockup-light` (og 1200×630) per asset-request item 5's reserved-zone spec. Wire into `spectator-share.html` preview, og:image for landing and spectator, and the Phase 6 share-card generator.
- **P3.4a Ice-themed dynamic share preview** *(added 2026-07-13 per Jamie: the live-score preview card in Messages looks like a pixelated old scoreboard, nothing like the app)*. **Current state:** the share link's og:image is generated by `renderPreviewPng()` in `api/spectator-share-lib.js` — a hand-rolled pure-JS rasterizer that fills a pixel buffer with flat rounded rects and draws the score using a homemade segment-style glyph font (`drawScoreGlyphTextCentered`). No fonts, no texture, no crests, no lockup. Separately, the static `spectator-share.html` declares `og:image` = `/spectator-preview.svg` — SVG og-images are not rendered by most scrapers (iMessage, WhatsApp, Slack), so that surface falls back to nothing.
  **Change (keep the zero-dependency architecture, replace its primitives with baked art):**
  1. Bake at build time (PIL script, committed under `outputs/brand/share-template/` with the generator): `assets/share/preview-bg-1200x630.png` — the Ice template: band ice texture, glass scoreboard card matching the spectator hero (crest slots, period pill slot, LIVE pill rendered in the corner), `lockup-light` bottom-center. Also bake sprite sheets from the real TTFs in `outputs/brand/fonts/`: Saira Semi Condensed digits `0–9` at score size (~110px) and letters `A–Z` at crest-initial (~40px) and label (~26px) sizes, white + tinted variants, RGBA PNGs.
  2. Rewrite `renderPreviewPng()` to alpha-composite: template + crest-initial sprites (team/opponent from the live model — the payload has carried `teamName`/`opponentName` since P1.1) + Saira digit sprites for score and period + a STARTING SOON / FINAL pill variant per model state. Pure buffer compositing (same skills as the current code), no new deps, keep the 60s cache headers. Target response ≤ 300 KB.
  3. Point BOTH surfaces at it: the dynamic share HTML keeps its og:image → `/api/spectator-preview?live=CODE`; `spectator-share.html` swaps its SVG og:image for a baked static PNG fallback (`assets/share/preview-static-1200x630.png`, same template with placeholder crests) since scrapers won't rasterize SVG. Keep `spectator-preview.svg` only if anything else references it; otherwise flag for deletion.
  **Accept:** share a live link and validate with an og scraper (or curl the endpoint and inspect): 1200×630 PNG, crisp Saira digits, real team initials on crests, ice texture, lockup; waiting and final states render their pill variants; response ≤ 300 KB; static page preview no longer blank in scrapers that reject SVG. Claude-buildable alone (fonts + textures + lockup all on hand).
- **P3.5 Empty-state illustrations** (if delivered) → Past Games/Season/Player empty states.
**Accept per asset:** renders on dark bg, retina-crisp, file ≤ budget, and the placeholder it replaces is deleted from the repo.

## Phase 4 — Scoring & domain credibility (parallel-safe)

- **P4.1** Level-consistent xG: derive `XG_RATES` from `LEVEL_PROFILES` (`js/app.js:1753–1767`): per level, `normal=(1−baseSV)×0.9`, `hd=min(2.5×normal,0.45)`, missed-chance xG credit scaled proportionally. Alternative accepted by audit: relabel xGF/xGA as unitless "Chance Quality" — pick the derivation option unless Jamie objects. **Accept:** U11 25-shot game shows xGA within ±1 of `LEVEL_PROFILES` expected GA.
- **P4.2** Recalibration pass per SCORING_ROADMAP §4A harness (temporary test page): fix dampening over-protection (5 GA/15 shots must land ≤ 40 — try negative-side spread 2.5), add shutout bonus (+0.75 input when GA=0 && SA≥20), fix the stale comment at `js/app.js:1908`, floor PP-soft progressive weight at `max(0.7, progressive×0.75)` so a 3rd PK softie ≥ a 2nd evens softie. Re-run all 12 audit scenarios; paste table into commit.
- **P4.3** Dampening disclosure: show "Only {X} shots — score pulled toward average until 20+" whenever confidence < 1 (summary + ring tooltip; currently only <10, `js/app.js:2626–2634, 3746–3748`).
- **P4.4** PP/PK: `pkOpps=max(penaltiesTaken, ppGA)`, `ppOpps=max(penaltiesDrawn, ppGF)` (`js/app.js:2499–2506`, season `6472–6476`); render the "based on penalties logged (approx.)" sub-line scoped in STATS_UX 2A.
- **P4.5** +/-: exclude PP goals-for (`js/app.js:1731–1742`).
- **P4.6** Terminology canon, one pass: full forms "Odd-Man Rush / DZ Turnover / Forced Turnover"; compact "OMR / DZ TO / Forced TO"; "Pen Drawn / Pen Taken" replaces "Pen For / Pen Ag" (`js/app.js:2764–2765`); never mix full+compact in one grid (`:2675` vs `:2684`); baseline no-data: team returns 63 like goalie (`:1938`); "Goalie change: P{n}" note in per-goalie section (STATS_UX 3E); landing "objective" → "consistent, context-aware".

## Phase 5 — Rink-side UX polish (post-token)

- **P5.1** 44px targets: period chips + goalie Switch + Share Live (padding-based hit areas); period change gets a confirm-flash like Next Period.
- **P5.2** Fixed-height Chance Quality slot on live screen from game start ("Not enough data yet" state) — kills the 85px grid shift.
- **P5.3** Undo: quick-tap shows "Undid: {event}" toast + Restore; `undo()` calls `save()` (`js/app.js:1240–1247`).
- **P5.4** Last-event ticker under the goalie chip ("✓ Shot For — #7"), doubles as undo target.
- **P5.5** Panels: `scrollIntoView` on open + pill active state; accordion (opening one closes others).
- **P5.6** Minimal `popstate` layer: back closes topmost modal/panel before exiting.
- **P5.7** Small fixes batch: strength picker "(required)"→"(optional)"; on-ice "Unk +"→"+1 Unknown skater"; switch-goalie picker-first (per GOALIE_PLAN locked copy); guest Account "Cloud sync: Synced"→"Local + anonymous backup"; hide End Season for guests; Reset Season out of panel headers into an overflow; `inputmode="numeric"` on `goalieAddInput`; setup empty-state deduped to chip + card only; roster textareas → list UI with Add Player + tap-to-remove (PRE 4B — numbers only, no name fields, privacy constraint).
- **P5.8** Dialog semantics pass: `role="dialog"`, `aria-modal`, focus move on open/return on close, Escape closes — modals only (full a11y audit deferred).

## Phase 6 — Parent-side premium (own workstream; needs pricing sign-off)

Build order: (1) **Share cards** — post-game image generator (final score + crests + goalie score + shot bar on ice art; 1080×1920 + 1200×630) — free at launch, the marketing loop; (2) **Season in Review** — card-stack recap per team/season (record, score trends, milestones, per-goalie) — flagship premium per Strava's Dec 2025 move; (3) **Premium gates**: spectator history beyond live + last game, season recaps, per-goalie season analytics, CSV/JSON export — live share and live scoring NEVER gated; (4) **Payment**: web-only checkout (Stripe), $39–59/yr family anchor (GameChanger $99 is the ceiling, we undercut as challenger); guest→account migration already built (PRE 7B) is the conversion path; upgrade prompts at: game saved, share link opened by 3+ viewers, season dashboard opened. Detailed spec to be written when Phases 0–2 have shipped.

### Status & task log (Phase 6)
- **6.1 Share cards → ✅ DONE (v6.4.2, 2026-07-21).** Post-game recap card (`js/share-card.js`, on-device canvas, 1080×1920) — free, the growth loop; shipped and refined per Jamie's on-device review (6.1a orientation-match + rebalance + footer copy, 6.1c shots-stat team attribution). Plus the app's own **landing link-preview card** (`assets/share/og-landing-1200x630.png`, baked by `outputs/brand/og-landing/bake_og_landing.py`; og:image wiring in `index.html`) — 6.1b — which fixed the app URL rendering nothing when shared. All verified live in production.
- **6.2 Roster UI → ✅ DONE (v6.4.4).** Jersey-chip editor replaced the raw textareas and the old duplicate roster modal. Numbers only, "00" distinct from "0", always-visible 44px tap-to-remove, legacy goalie names flagged "NEEDS #" not dropped. Verified 12/12 on mobile.
- **6.3a Naming → ✅ DONE (v6.4.5).** "Team Score"/"Goalie Score" unified to "Team Rating"/"Goalie Rating" everywhere user-facing.
- **6.3 Season in Review → ✅ DONE (v6.4.6).** Swipeable 7-card recap over real season data (Cover, Record, Goals, Territory, The Climb rating trend, Between the Pipes per-goalie, Wrap). Free-first, gated in 6.4. Entry: Season panel CTA at 6+ games plus an end-season offer. Privacy: jersey numbers only, legacy names anonymized to G1. Share-to-image export deferred to a follow-up. Verified 8/8 on mobile.
- **6.LP Landing refresh → ✅ DONE (v6.4.7).** Restructured to surface every selling point, live spectator elevated to position 3, three new sections (share recap card, By Goalie, roster), owner-approved plain copy, zero em dashes. Rich existing sections kept (Jamie's call).
- **6.4 Premium gates + 6.5 Stripe checkout → IN PROGRESS.** Pricing LOCKED at $49/yr per family (Jamie, 2026-07-21). Live scoring and the live spectator link are never gated. Monetization architecture design pass underway (entitlement model, gating points, upgrade UX, Stripe checkout + webhook); plan lands in `outputs/MONETIZATION_PLAN.md`. Stripe account, keys, and product setup are Jamie's to do (Claude cannot handle credentials).
- **6.PWA Install experience polish (NEW, from a separate chat, 2026-07-21).** Back the landing's new "Add to your home screen" claim with a real flow. Capture the Chrome/Android `beforeinstallprompt` event for a lightweight, dismissible one-tap "Add to Home Screen" prompt at a good moment (e.g. after a game is saved). Show a short one-time iOS hint (detect iOS and non-standalone: "Tap Share, then Add to Home Screen," with the share glyph), because iOS Safari never fires `beforeinstallprompt`. Plain copy, no em dashes. Standalone polish, not blocking monetization.

---

## Asset requests for Jamie's GPT 5.6 brand library

Drop into `outputs/brand/` with these exact names. Constraints for everything: must read on dark surfaces (`#0C1219`), align with teal `#17B6C8` + the Ice palette, pair with Saira Semi Condensed's sharp/condensed voice. **No identifiable children's faces in any imagery** (youth-sports privacy; silhouettes/back-of-jersey/distance shots are fine).

| # | File(s) | Spec | Used in |
|---|---|---|---|
| 1 | `logo-mark.svg` | The mark alone. Vector SVG, square-ish, single-color-capable, legible at 16px. Brief: hockey + insight (e.g. blade-cut "S", puck-as-datapoint, crest shape echoing the app's 13/15px-radius crest component). Provide `logo-mark-mono.svg` (pure white) too. | favicon, app icon base, header |
| 2 | `logo-lockup-horizontal.svg` | Mark + "SMART TEAM TRACKER" wordmark (Saira Semi Condensed 800 or a custom-drawn equivalent), horizontal, on transparent. Also `logo-lockup-stacked.svg`. | landing hero, auth, share cards, spectator footer |
| 3 | `icon-master-1024.png` | 1024×1024 app icon: mark on `#0C1219`→`#141C26` subtle gradient, content within the central 80% (maskable-safe). I derive 512/192/180/favicon from this. | PWA install, home screen |
| 4 | `hero-rink-wide.png` | ~2400×1350 rink/bench scene, moody dark-ice grade matching `#0A0F18`, clear space on the LEFT third for headline text. Plus `hero-rink-portrait.png` ~1200×1600. | desktop + mobile landing |
| 5 | `share-card-bg-story.png` + `share-card-bg-og.png` | ✅ BASE DELIVERED 2026-07-12: derive both frames from `ice-texture-light-1920.webp`/4K master (Canva) + `lockup-light` — Claude composites these; no external asset needed unless a fancier frame is wanted. | post-game share cards, og:image |
| 6 | `empty-states/*.svg` (optional, 5) | Spot illustrations, single-stroke style matching Lucide stroke-2 icons, teal accent only: empty history, empty season, empty players, no-connection, season-archived. | panel empty states |
| 7 | ~~`texture-frost-tile.png`~~ | ✅ SUPERSEDED 2026-07-12 by the Canva-generated ice-texture set: `outputs/brand/ice-texture-master.png` (4K) + baked variants `ice-texture-dark-1920.webp` (whisper, app page backgrounds — P2.4), `ice-texture-band-1920.webp` (summary/season bands, spectator desktop letterbox — P2.5), `ice-texture-light-1920.webp` (share/og — P3.4). Canva design saved to Jamie's account: canva.com/d/YnGGwKuUrkXB2Z2. | app-wide backgrounds |

Priority order if produced incrementally: **3 → 1 → 2 → 5 → 4 → 6 → 7** (icons unblock the PWA replacement first; the mark feeds everything).

---

## Standing constraints (apply to every phase)
- Commit-only workflow; Jamie pushes (GitHub Desktop).
- No names or personal data of minors anywhere (rosters stay jersey-numbers-only).
- Live scoring and the live share link are never paywalled.
- Every phase ends with the repo's existing verification ritual: Mac browser + iPhone pass, guest mode, and the P1.3(l)-style checklist for touched surfaces.
- **Any phase touching `api/*` must also pass `node scripts/api-smoke.mjs <deploy-url>` after deploy.** The local ritual cannot cover the serverless surface: `dev_server.py` is a Python reimplementation of those routes, so `api/*.js` is never executed until it reaches Vercel. That gap shipped both spectator share endpoints returning `FUNCTION_INVOCATION_FAILED` (no og card, error on tap) and it went unnoticed for days — the fix was to drop `vercel.json`'s `functions`/`includeFiles` block and embed the sprites in the module graph instead (hotfix `e28e27f`, 2026-07-20). This matters most for Phase 6.5 (Stripe), which is entirely serverless.
