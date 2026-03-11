# UX Audit Roadmap — Round 4 (Monetisation-Ready)

Previous rounds addressed layout density, button consistency, colour tokens, radius tokens, skeleton loaders, focus rings, animations, modal consistency, and hat trick celebrations. This round targets the remaining gap between "polished hobby project" and "product someone would pay for."

---

## PHASE 1 — High Priority (Conversion & Perceived Value)

These three changes most directly affect whether a user perceives this as a paid-tier product.

### 1A. Coach Screen: Increase Button Visual Hierarchy

**Problem:** 14 buttons visible at once, all at roughly the same visual weight. Primary actions (Shot/Goal) are not visually distinct enough from context buttons (Breakaway, DZ Turnover) in low-light rink conditions.

**File:** `css/styles.css`

| Element | Current | Change To | Rationale |
|---------|---------|-----------|-----------|
| `.g-btn.primary` box-shadow | `0 4px 12px rgba(0,0,0,0.5)` | `0 6px 18px rgba(0,0,0,0.6)` | Deeper shadow lifts primaries off the surface |
| `.theme-them .g-btn.primary` background | `#3a0e0e` | `#441010` | Slightly brighter to widen gap vs context |
| `.theme-us .g-btn.primary` background | `#0f2b45` | `#123350` | Same — slightly brighter |
| `.theme-them .g-btn.ctx` opacity | (none) | Add `opacity: 0.82` | Recesses context buttons visually |
| `.theme-us .g-btn.ctx` opacity | (none) | Add `opacity: 0.82` | Same |
| `.theme-them .g-btn.ctx` border-color | `rgba(90,26,26,0.6)` | `rgba(90,26,26,0.4)` | Softer border to reduce parity with primaries |
| `.theme-us .g-btn.ctx` border-color | `rgba(26,58,90,0.6)` | `rgba(26,58,90,0.4)` | Same |

**Test:** On a phone at arm's length, the four primary buttons (Shot Against, Goal Against, Shot For, Goal For) should be the first things your eye finds. Context buttons should feel "available but secondary."

### 1B. Coach Screen: Surface SV% in Sticky Header

**Problem:** Save percentage — the coach's most-checked stat — requires scrolling past the entire button grid to see in the dashboard.

**File:** `js/app.js` — in the function that updates `liveSF_sub` and `liveSA_sub` text.

**Current behaviour:** `liveSA_sub` shows `SA: {n}`. `liveSF_sub` shows `SF: {n}`.

**Change:** When in-game and `shotsAgainst > 0`, change `liveSA_sub` to show `SA: {n} · {svPct}` where `svPct` is formatted as `.XXX` (e.g., `.917`). When `shotsAgainst === 0`, keep `SA: 0`.

Find the render function that sets these sub-labels (search for `liveSA_sub` in `app.js`) and add:

```javascript
// After setting SA count:
const sa = state.countsA.shots;
const ga = state.countsA.goals;
if (sa > 0) {
  const saves = sa - ga;
  const svPct = (saves / sa);
  const svStr = svPct >= 1 ? '1.000' : '.' + String(Math.round(svPct * 1000)).padStart(3, '0');
  $('liveSA_sub').textContent = `SA: ${sa} · ${svStr}`;
} else {
  $('liveSA_sub').textContent = 'SA: 0';
}
```

**No new elements.** This modifies the text content of an existing element only.

### 1C. Setup Screen: Promote History/Stats Links to Feature Pills

**Problem:** "Past Games," "Season Stats," and "Player Stats" are styled as bare text links at the bottom of setup. They look like footnotes, not features. These represent the app's long-term value — the exact thing that justifies a subscription.

**File:** `css/styles.css`

Replace the `.setup-tertiary` and `.btn-tertiary-link` styles:

```css
.setup-tertiary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.btn-tertiary-link {
  padding: 10px 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  border-radius: 14px;
  color: #8ebeff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.08s ease;
  -webkit-tap-highlight-color: transparent;
}
.btn-tertiary-link:active {
  transform: scale(0.98);
  background: rgba(77,163,255,0.08);
}
.btn-tertiary-link:disabled {
  color: #4e5864;
  cursor: not-allowed;
  opacity: 0.5;
}
```

At `@media (max-width: 430px)`:
```css
.setup-tertiary {
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.btn-tertiary-link {
  padding: 9px 6px;
  font-size: 12px;
}
```

**No HTML changes.** Same three buttons, new visual treatment.

---

## PHASE 2 — Medium Priority (Polish & Trust Signals)

### 2A. Setup Screen: Hide Redundant Disabled CTA

**Problem:** When no team exists, both the "Team Required" chip and the disabled "Add Team to Start" button convey the same message. Two signals of incompleteness feel uncertain.

**File:** `js/app.js` — in `updateSetupReadiness()`.

**Change:** When `!team`, hide `btnStartGame` entirely (not just disable it) and let the "Add Your Team" card be the sole CTA. The chip stays as a label.

```javascript
// In updateSetupReadiness(), after determining `team` and `ready`:
if (!team) {
  startBtn.style.display = 'none';
} else {
  startBtn.style.display = '';
}
```

**Revert display on team selection** — the existing flow already calls `updateSetupReadiness()` when the team changes, so this is self-correcting.

### 2B. Setup Screen: Reserve Space for Matchup Card

**Problem:** When an opponent with history is selected, the matchup card animates in and causes layout shift below the opponent field.

**File:** `css/styles.css`

Add a transition to the matchup card's appearance:

```css
.matchup-card {
  /* existing styles stay */
  transition: opacity 0.25s ease, max-height 0.3s ease;
  overflow: hidden;
}
.matchup-card.hidden {
  display: block !important;
  max-height: 0;
  opacity: 0;
  margin: 0;
  padding: 0;
  border: none;
  overflow: hidden;
}
```

**Override** the global `.hidden { display: none !important }` specifically for this card so it can transition smoothly. When shown, remove the `hidden` class and the card expands into its natural height.

**File:** `js/app.js` — wherever `matchupInsight.classList.add/remove('hidden')` is called, no JS changes needed if the CSS handles the visual transition.

### 2C. Setup Screen: Relocate +/- Toggle Below Start Game

**Problem:** The Track +/- toggle sits between the form fields and the Start Game button, creating a speed bump on the critical path for coaches who don't know what +/- means.

**File:** `index.html`

Move the `setup-toggle-row` block (the one containing `togglePM`) from its current position (between the date field and `setupRequirement`) to immediately **after** `btnStartGame` and before `setup-tertiary`:

```html
<!-- After btnStartGame and startHint, before setup-tertiary -->
<div class="setup-section-label">Options</div>
<div class="setup-toggle-row">
  <div>
    <div class="setup-toggle-title">Track +/-</div>
    <div class="setup-toggle-copy">Prompt for the five skaters on the ice after each goal.</div>
  </div>
  <label class="switch"><input type="checkbox" id="togglePM" checked><span class="slider"></span></label>
</div>
```

Remove the old "Tracking" section label and toggle from their current position.

### 2D. Coach Screen: Increase Context Label Visibility

**Problem:** "Defensive Context" and "Offensive Context" labels are 9px at 0.6 opacity — effectively invisible in rink conditions.

**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.def-context-label` font-size | `9px` | `10px` |
| `.def-context-label` opacity | `0.6` | `0.8` |
| Add `.def-context-label` border-bottom | (none) | `1px solid currentColor; padding-bottom: 3px; opacity of border: use rgba` |

Specific addition:
```css
.def-context-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  opacity: 0.8;
  margin-top: 2px;
  padding-bottom: 3px;
}
.theme-them .def-context-label {
  border-bottom: 1px solid rgba(255,69,58,0.15);
}
.theme-us .def-context-label {
  border-bottom: 1px solid rgba(77,163,255,0.15);
}
```

### 2E. Coach Screen: Distinguish Next Period Button

**Problem:** The Next Period button blends into the dashboard below it. At intermission, the coach needs to find it quickly.

**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.next-period-btn` border-color | `#555` | `rgba(255,159,10,0.45)` |
| `.next-period-btn` background | `linear-gradient(135deg, #222, #1a1a1a)` | `linear-gradient(135deg, #252218, #1a1a1a)` |
| `.next-period-btn` color | `#fff` | `#ffd68a` |

Warm tone signals "transition action" — distinct from the blue/red game-tracking buttons above and the neutral dashboard below.

### 2F. Spectator Screen: KPI Split-Value Axis Labels

**Problem:** Spectator KPI cards show "X - Y" but don't clarify which is Them and which is Us. The colour coding exists in CSS but is too subtle at a glance.

**File:** `index.html` — Inside each `spec-kpi-card` that uses split values.

Add micro-labels to the KPI label row:

```html
<div class="spec-kpi-card">
  <div class="spec-kpi-label">Shots <span class="spec-kpi-axis">T - U</span></div>
  <div class="spec-kpi-value" id="specShotLine">0-0</div>
</div>
```

Repeat for Scoring Chances and Penalties cards.

**File:** `css/styles.css` — Add:

```css
.spec-kpi-axis {
  float: right;
  font-size: 9px;
  color: #5c6f8e;
  letter-spacing: 1px;
  font-weight: 600;
}
```

### 2G. Spectator Screen: Stale Feed Warning

**Problem:** Parents staring at an unchanging screen don't know if the game is slow or the feed is broken.

**File:** `js/spectator.js`

After each successful `renderState()` call, start/reset a 30-second timer. If the timer fires without a new update, add a CSS class to `specMetaLine`:

```javascript
let staleTimer = null;
function resetStaleTimer() {
  if (staleTimer) clearTimeout(staleTimer);
  const meta = $('specMetaLine');
  if (meta) meta.classList.remove('spec-meta-stale');
  staleTimer = setTimeout(() => {
    if (!spectatorEnded && meta) meta.classList.add('spec-meta-stale');
  }, 30000);
}
```

Call `resetStaleTimer()` at the end of every successful `renderState()`.

**File:** `css/styles.css` — Add:

```css
.spec-meta-stale {
  color: rgba(255,159,10,0.6);
}
```

---

## PHASE 3 — New Features (Experiential Value)

### 3A. Period-End Flash Summary

**Trigger:** Coach taps "Next Period" button.

**Visual:** A card overlays the top of the game controls area for 4 seconds, showing a one-line period summary:

> **P1 Complete** — 8-5 shots, 1-0 goals, SV% .833

Auto-dismisses after 4 seconds or on tap. Slides in from the top of the `.wrap` container, not fixed-position (so it doesn't cover the header).

**File:** `js/app.js` — In the Next Period handler (find `btnNextPeriod` click listener):

After advancing the period, call a new function:

```javascript
function showPeriodSummary(completedPeriod) {
  const p = per[completedPeriod];
  if (!p) return;

  const sf = p.F_shots;
  const sa = p.A_shots;
  const gf = p.F_goals;
  const ga = p.A_goals;
  const saves = sa - ga;
  const svPct = sa > 0
    ? (saves / sa >= 1 ? '1.000' : '.' + String(Math.round((saves / sa) * 1000)).padStart(3, '0'))
    : '—';
  const pLabel = completedPeriod === 4 ? 'OT' : `P${completedPeriod}`;

  const el = document.createElement('div');
  el.className = 'period-summary-flash';
  el.innerHTML =
    `<div class="period-summary-label">${pLabel} Complete</div>` +
    `<div class="period-summary-line">${sa}-${sf} shots · ${ga}-${gf} goals · SV% ${svPct}</div>`;

  const wrap = document.querySelector('.wrap');
  const controls = $('gameControls');
  if (wrap && controls) {
    wrap.insertBefore(el, controls);
  } else {
    document.body.appendChild(el);
  }

  el.addEventListener('click', () => { if (el.parentNode) el.remove(); });
  setTimeout(() => {
    el.classList.add('period-summary-exit');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
  }, 4000);
}
```

**File:** `css/styles.css` — Add:

```css
.period-summary-flash {
  background: linear-gradient(180deg, rgba(18,20,25,0.97), rgba(10,11,13,0.99));
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 8px;
  text-align: center;
  animation: period-summary-in 0.3s ease-out;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.period-summary-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--warn);
  margin-bottom: 4px;
}
.period-summary-line {
  font-size: 14px;
  font-weight: 600;
  color: #eef3f8;
}
@keyframes period-summary-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.period-summary-exit {
  animation: period-summary-out 0.3s ease-in forwards;
}
@keyframes period-summary-out {
  to { opacity: 0; transform: translateY(-8px); }
}
```

### 3B. Spectator "Just Joined" Context Card

**Trigger:** On first successful data render in spectator mode.

**Visual:** A dismissible card above the KPI grid showing a single-line game summary:

> **P2 · Up 3-1 · 14-8 shots · SV% .917**

Auto-dismisses after 8 seconds or on tap.

**File:** `js/spectator.js` — After the first `renderState()` call (when `!lastState && incoming`):

```javascript
function showJoinedContext(s) {
  const existing = document.querySelector('.spec-joined-card');
  if (existing) return;

  const pLabel = s.period === 4 ? 'OT' : `P${s.period}`;
  const diff = s.goalsFor - s.goalsAgainst;
  const result = diff > 0 ? `Up ${s.goalsFor}-${s.goalsAgainst}`
    : diff < 0 ? `Down ${s.goalsFor}-${s.goalsAgainst}`
    : `Tied ${s.goalsFor}-${s.goalsAgainst}`;
  const sa = s.shotsAgainst || 0;
  const ga = s.goalsAgainst || 0;
  const saves = sa - ga;
  const svStr = sa > 0
    ? (saves / sa >= 1 ? '1.000' : '.' + String(Math.round((saves / sa) * 1000)).padStart(3, '0'))
    : '—';

  const el = document.createElement('div');
  el.className = 'spec-joined-card';
  el.textContent = `${pLabel} · ${result} · ${s.shotsAgainst}-${s.shotsFor} shots · SV% ${svStr}`;
  el.addEventListener('click', () => { if (el.parentNode) el.remove(); });

  const kpi = document.querySelector('.spec-kpi-grid');
  if (kpi && kpi.parentNode) {
    kpi.parentNode.insertBefore(el, kpi);
  }

  setTimeout(() => {
    el.classList.add('spec-joined-exit');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
  }, 8000);
}
```

Call `showJoinedContext(incoming)` in `fetchLiveState` when `!lastState && incoming && hasSeenLiveData` (first render).

**File:** `css/styles.css` — Add:

```css
.spec-joined-card {
  position: relative;
  z-index: 1;
  text-align: center;
  background: rgba(9,14,24,0.84);
  border: 1px solid #203149;
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #d5deee;
  cursor: pointer;
  animation: period-summary-in 0.3s ease-out;
  -webkit-tap-highlight-color: transparent;
}
.spec-joined-exit {
  animation: period-summary-out 0.3s ease-in forwards;
}
```

### 3C. Coach Haptic Patterns on Goal

**Trigger:** Goal For or Goal Against is recorded.

**Current:** `vibrate(HAPTIC.tap)` — a single short pulse for all events.

**Change:** Define distinct haptic patterns for goals:

**File:** `js/app.js` — Find the `HAPTIC` constant definition and add:

```javascript
// Add to HAPTIC object:
goalFor: [40, 60, 40],      // double-tap: quick-pause-quick
goalAgainst: [80],           // single longer pulse
```

Then in the Goal For handler, use `vibrate(HAPTIC.goalFor)` instead of `vibrate(HAPTIC.tap)`. In the Goal Against handler, use `vibrate(HAPTIC.goalAgainst)`.

---

## PHASE 4 — Low Priority (Fit & Finish)

### 4A. Coach Screen: Subtle FAB Ring

**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.fab-undo` border | `2px solid var(--gray-500)` | `2px solid rgba(77,163,255,0.2)` |

### 4B. Setup Screen: Calendar Icon on Date Field

**File:** `index.html` — Inside `.setup-date-shell`, after `#dateDisplay`:

```html
<svg class="date-field-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
  <line x1="16" y1="2" x2="16" y2="6"/>
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
</svg>
```

**File:** `css/styles.css` — Add:

```css
.date-field-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #6b7d94;
  pointer-events: none;
}
```

### 4C. Spectator Screen: Truncate Insight Text on Narrow Screens

**File:** `css/styles.css` — At `@media (max-width: 400px)`:

```css
.spec-intensity-text,
.spec-momentum-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 4D. Spectator Screen: Game Feed Start Anchor

**File:** `js/spectator.js` — In `renderEvents()`, after building the event rows HTML, append a footer if events exist:

```javascript
if (rows.length) {
  const earliest = rows[rows.length - 1];
  const startTime = formatTimeLabel(earliest.tISO);
  html += `<div class="spec-event-anchor">Game started${startTime ? ' at ' + escapeHtml(startTime) : ''}</div>`;
}
```

**File:** `css/styles.css` — Add:

```css
.spec-event-anchor {
  text-align: center;
  font-size: 11px;
  color: #4a5d7a;
  padding: 12px 0 8px;
  border-top: 1px solid #182336;
}
```

---

## Implementation Order & Estimates

| Phase | Scope | Files Touched | Nature |
|-------|-------|---------------|--------|
| **1A** Button hierarchy | `css/styles.css` | CSS only |
| **1B** SV% in header | `js/app.js` | ~8 lines JS |
| **1C** Feature pills | `css/styles.css` | CSS only |
| **2A** Hide redundant CTA | `js/app.js` | ~4 lines JS |
| **2B** Matchup card transition | `css/styles.css` | CSS only |
| **2C** Move +/- toggle | `index.html` | HTML move |
| **2D** Context label visibility | `css/styles.css` | CSS only |
| **2E** Next Period distinction | `css/styles.css` | CSS only |
| **2F** KPI axis labels | `index.html`, `css/styles.css` | HTML + CSS |
| **2G** Stale feed warning | `js/spectator.js`, `css/styles.css` | ~10 lines JS + CSS |
| **3A** Period-end summary | `js/app.js`, `css/styles.css` | ~25 lines JS + CSS |
| **3B** Joined context card | `js/spectator.js`, `css/styles.css` | ~25 lines JS + CSS |
| **3C** Haptic patterns | `js/app.js` | ~4 lines JS |
| **4A** FAB ring | `css/styles.css` | CSS only |
| **4B** Calendar icon | `index.html`, `css/styles.css` | HTML + CSS |
| **4C** Text truncation | `css/styles.css` | CSS only |
| **4D** Feed anchor | `js/spectator.js`, `css/styles.css` | ~5 lines JS + CSS |

**Recommended commit sequence:**
1. Phase 1 (all three) — single commit: "Monetisation-ready: button hierarchy, header SV%, feature pills"
2. Phase 2A-2E — single commit: "UX polish: setup flow, context labels, period button"
3. Phase 2F-2G — single commit: "Spectator trust signals: axis labels, stale warning"
4. Phase 3 — single commit: "New features: period summary, joined card, goal haptics"
5. Phase 4 — single commit: "Fit and finish: FAB, calendar icon, truncation, feed anchor"
