# UX Audit Roadmap — SmartTeamTracker

Precise, ordered changes. Each item specifies the file, the element, and exactly what changes.

---

## PRIORITY 1: Setup Screen — Fit on One Phone Screen (~667px viewport)

**Goal:** The entire setup screen (from header to Start Game button) must be visible without scrolling on a standard iPhone (375×667 logical pixels).

**Current problem:** The setup card has ~28px top padding, 18px section-label margins, 14px input-group margins, a full matchup card, toggle row with description text, an inline note, and generous spacing that pushes the Start Game button well below the fold.

### 1A. Collapse vertical spacing in setup card
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.setup-card` padding (line 430) | `28px 24px 22px` | `20px 20px 16px` |
| `.setup-card` margin-top (line 431) | `18px` | `10px` |
| `.setup-eyebrow` margin-bottom (line 448) | `12px` | `8px` |
| `.setup-section-label` margin (line 493) | `18px 0 10px` | `12px 0 6px` |
| `.input-group` margin-bottom (line 502) | `14px` | `10px` |
| `.setup-toggle-row` padding (line 870) | `14px 16px` | `10px 14px` |
| `.btn-start` margin-top (line 610) | `12px` | `8px` |
| `.btn-start` padding (line 606) | `16px 18px` | `14px 16px` |
| `.setup-tertiary` margin-top (line 903) | `14px` | `10px` |
| `.setup-fields` gap (line 639) | `12px` | `8px` |

### 1B. Reduce header title size on setup screen
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `body:not(.in-game) .top-row h1` (line 144) | `font-size:36px` | `font-size:28px` |
| `body:not(.in-game) .top-row` min-height (line 125) | `64px` | `52px` |
| `body:not(.in-game) .top-row` padding (line 124) | `16px 18px 12px` | `12px 16px 8px` |

### 1C. Compact the setup card heading
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.setup-card h2` (line 466) | `font-size:31px` | `font-size:24px` |
| `body:not(.in-game) .setup-card h2` (line 471) | `font-size:28px` | `font-size:22px` |
| `.setup-sub` margin-top (line 474) | `8px` | `4px` |
| `.setup-sub` font-size (line 476) | `14px` | `13px` |

### 1D. Reduce input field padding
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `input, select, textarea` padding (line 556) | `14px 15px` | `12px 14px` |
| `.setup-date-shell` min-height (line 515) | `42px` | `38px` |
| `.setup-date-shell` padding (line 519) | `10px 14px` | `8px 12px` |

### 1E. Compact toggle row copy
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.setup-toggle-copy` margin-top (line 881) | `4px` | `2px` |
| `.setup-toggle-copy` font-size (line 882) | `12px` | `11px` |
| `.setup-toggle-copy` line-height (line 883) | `1.4` | `1.3` |

### 1F. Hide the matchup card by default, show only on opponent selection
**File:** `index.html` — Already has `class="matchup-card hidden"` on `#matchupInsight` (line 157). **No change needed** — just confirm it stays hidden until an opponent with history is selected.

### 1G. Update responsive breakpoints to match
**File:** `css/styles.css`

At `@media (max-width: 430px)`:
| Element | Current | Change To |
|---------|---------|-----------|
| `.setup-card` padding (line 2739) | `14px 14px 14px` | `12px 12px 12px` |
| `.setup-card h2` (line 2743) | `font-size:22px` | `font-size:20px` |
| `body:not(.in-game) .setup-card h2` (line 2745) | `font-size:20px` | `font-size:18px` |
| `.btn-start` padding (line 2824) | `13px 15px` | `12px 14px` |
| `.btn-start` font-size (line 2825) | `16px` | `15px` |

---

## PRIORITY 2: Coach Screen Buttons — All Fit on One Phone Screen

**Goal:** All tracking buttons (Shot/Goal/Smother/Save/Context rows) for both columns must be visible without scrolling, above the Next Period bar, on a 375×667 viewport.

**Current problem:** `.h-lg` buttons are 74px tall, `.h-md` buttons are 52px min-height, context labels add margins, and the gap is 8px. Total height for one column: ~74+74+52+52 + context-label + 52+52+52 + gaps ≈ 530px+ before the Next Period bar. With header+scoreboard (~160px), this overflows.

### 2A. Reduce primary button heights
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.h-lg` height (line 1005) | `74px` | `58px` |
| `.h-lg` font-size (line 1006) | `16px` | `15px` |
| `.h-md` min-height (line 1011) | `52px` | `40px` |
| `.h-md` font-size (line 1012) | `13px` | `12px` |

### 2B. Reduce grid and column gaps
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.split-grid` gap (line 960) | `8px` | `6px` |
| `.col-zone` gap (line 966) | `8px` | `5px` |
| `.context-row` gap (line 1068) | `6px` | `4px` |
| `.split-grid` margin-top (line 961) | `8px` | `4px` |

### 2C. Compact context labels
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.def-context-label` font-size (line 1072) | `10px` | `9px` |
| `.def-context-label` margin-top (line 1076) | `4px` | `2px` |

### 2D. Compact col-label (Them/Us)
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.col-label` margin-bottom (line 1061) | `4px` | `2px` |
| `.col-label` font-size (line 1057) | `10px` | `9px` |

### 2E. Reduce Next Period bar
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.next-period-wrap` margin-top (line 1081) | `10px` | `6px` |
| `.next-period-btn` height (line 1090) | `44px` | `38px` |
| `.next-period-btn` font-size (line 1087) | `14px` | `13px` |

### 2F. Reduce scoreboard height when in-game
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.score-block` min-height (line 332) | `64px` | `56px` |
| `.score-block` padding (line 330) | `10px 10px` | `8px 8px` |
| `.score-val` font-size (line 345) | `30px` | `26px` |
| `.scoreboard-row` padding bottom (line 244) | `8px` | `6px` |
| `body.in-game .top-row` padding (line 115) | `10px 14px` | `8px 12px` |

---

## PRIORITY 3: Button System Consistency

**Goal:** Unify border-radius, transition timing, and active states across all button types.

### 3A. Standardize border-radius to 12px for all buttons
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.g-btn` border-radius (line 972) | `14px` | `12px` |
| `.btn-start` border-radius (line 609) | `16px` | `12px` |
| `.btn-std` border-radius (line 1727) | `10px` | `12px` |
| `.btn-icon` border-radius (line 165) | `9px` | `10px` |
| `.toolbar-btn` border-radius (line 186) | `9px` | `10px` |

### 3B. Standardize active press effect
**File:** `css/styles.css`

Every button currently uses slightly different scale values. Standardize:
- All standard buttons: `transform: scale(0.97)` on `:active`
- `.g-btn:active` (line 990): change `scale(0.95)` → `scale(0.97)`
- `.btn-icon:active` (line 179): change `scale(0.9)` → `scale(0.95)`
- `.btn-start:active` (line 617): keep `scale(0.98)` (large button, subtler)

### 3C. Remove dashed border from context buttons
**File:** `css/styles.css`

The dashed borders on `.ctx` buttons make them look unfinished/placeholder.

| Element | Current | Change To |
|---------|---------|-----------|
| `.theme-them .g-btn.ctx` border-style (line 1028) | `dashed` | `solid` |
| `.theme-them .g-btn.ctx` border-color (line 1027) | `#5a1a1a` | `rgba(90,26,26,0.6)` |
| `.theme-us .g-btn.ctx` border-style (line 1050) | `dashed` | `solid` |
| `.theme-us .g-btn.ctx` border-color (line 1049) | `#1a3a5a` | `rgba(26,58,90,0.6)` |

Context buttons differentiate by: lighter background + smaller text + thinner border (already present). Dashed is redundant.

---

## PRIORITY 4: Color Token Cleanup

**Goal:** Reduce the number of ad-hoc gray values to a consistent scale.

### 4A. Define gray scale in CSS variables
**File:** `css/styles.css` — Add to `:root` (line 1):

```css
--gray-50: #0a0a0a;
--gray-100: #111111;
--gray-200: #1a1a1a;
--gray-300: #222222;
--gray-400: #333333;
--gray-500: #444444;
--gray-600: #888888;
--gray-700: #aaaaaa;
--gray-800: #cccccc;
--gray-900: #eeeeee;
```

### 4B. Replace hardcoded grays with variables
**File:** `css/styles.css` — Systematic find-and-replace:

| Hardcoded | Replace With | Occurrences (approx) |
|-----------|-------------|---------------------|
| `#0a0a0a` | `var(--gray-50)` | 3 |
| `#111` / `#111111` | `var(--gray-100)` / `var(--panel)` | 12 |
| `#1a1a1a` | `var(--gray-200)` | 14 |
| `#222` / `#222222` | `var(--gray-300)` | 10 |
| `#333` / `#333333` | `var(--gray-400)` | 18 |
| `#444` / `#444444` | `var(--gray-500)` | 8 |

This makes future theme changes trivial and eliminates drift.

---

## PRIORITY 5: Scoreboard & Header Refinement

### 5A. Add safe-area insets for notched phones
**File:** `css/styles.css`

Add to `.sticky-header`:
```css
padding-top: env(safe-area-inset-top, 0px);
```

Add to `body`:
```css
padding-left: env(safe-area-inset-left, 0px);
padding-right: env(safe-area-inset-right, 0px);
```

### 5B. Tighten quality bar spacing
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.quality-bar-wrap` padding (line 288) | `0 10px 6px 10px` | `0 10px 4px 10px` |

---

## PRIORITY 6: Live Dashboard Density (Below-Fold, Lower Priority)

### 6A. Reduce dashboard tile minimum heights
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.dashTile` min-height (line 1168) | `70px` | `60px` |
| `.dashTile` padding (line 1167) | `10px` | `8px 10px` |
| `.dashTile .v` font-size (line 1181) | `26px` | `22px` |
| `.dashTile .v` margin-top (line 1180) | `8px` | `5px` |

### 6B. Reduce rings row size
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.scoreRing` width/height (line 1519-1520) | `80px` | `72px` |
| `.scoreRing .val` font-size (line 1548) | `24px` | `20px` |
| `.ringsRow` margin-bottom (line 1402) | `10px` | `8px` |

### 6C. Reduce dash section label spacing
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.dash-section-label` margin (line 1154) | `14px 0 6px 4px` | `10px 0 4px 4px` |

---

## PRIORITY 7: Auth Screen Polish

### 7A. Reduce bottom margin on auth subtitle
**File:** `css/auth.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.auth-sub` margin-bottom (line 30) | `32px` | `24px` |
| `.auth-divider` margin (line 58) | `20px 0` | `16px 0` |
| `.auth-guest-divider` margin (line 152) | `16px 0` | `12px 0` |

### 7B. Unify auth button border-radius with app standard (12px)
**File:** `css/auth.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.auth-google-btn` border-radius (line 43) | `12px` | `12px` (already correct) |
| `.auth-input` border-radius (line 83) | `10px` | `12px` |
| `.auth-submit-btn` border-radius (line 109) | `12px` | `12px` (already correct) |
| `.auth-guest-btn` border-radius (line 161) | `12px` | `12px` (already correct) |

Only `.auth-input` needs to change: 10px → 12px.

---

## PRIORITY 8: Spectator View Fine-Tuning

### 8A. Add safe-area insets
**File:** `css/styles.css`

Add to `.spectator-view`:
```css
padding-top: max(14px, env(safe-area-inset-top, 14px));
padding-bottom: max(18px, env(safe-area-inset-bottom, 18px));
```

### 8B. Reduce score font size slightly on small phones
**File:** `css/styles.css` — Already handled at 380px breakpoint (line 2861). No change needed.

### 8C. Add connection state styling for spectator
**File:** `css/styles.css` — Add new rules:

```css
.spec-status.connecting { color: var(--warn); }
.spec-status.disconnected { color: var(--accent-them); }
```

---

## PRIORITY 9: Transition & Animation Consistency

### 9A. Standardize transition timing
**File:** `css/styles.css`

Currently transitions range from `0.08s` to `0.5s` with no system. Establish:
- **Micro-interactions** (button press): `0.1s ease-out`
- **State changes** (focus, hover): `0.18s ease`
- **Layout shifts** (expand/collapse): `0.25s ease`
- **Data animations** (bars, rings): `0.4s ease`

Specific changes:
| Element | Current | Change To |
|---------|---------|-----------|
| `.g-btn` transform transition (line 984) | `0.08s ease-out` | `0.1s ease-out` |
| `.btn-icon` transition (line 177) | `0.08s` | `0.1s ease-out` |
| `.toolbar-btn` transition (line 192) | `0.08s, 0.1s` | `0.1s ease-out` |

---

## PRIORITY 10: Modal & Toast Consistency

### 10A. Unify modal border-radius
**File:** `css/styles.css`

| Element | Current | Change To |
|---------|---------|-----------|
| `.modal .box` border-radius (line 1505) | `16px` | `20px` |
| `.confirm-box` border-radius (line 1845) | `16px` | `20px` |

### 10B. Add subtle border-top accent to modals (match setup-card style)
**File:** `css/styles.css` — Add:

```css
.modal .box::before {
  content: '';
  position: absolute;
  top: 0; left: 20px; right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(77,163,255,0.3), transparent);
  border-radius: 999px;
}
.modal .box { position: relative; overflow: hidden; }
```

---

## Implementation Order

1. **P1 (Setup fits on screen)** — CSS-only, ~25 property changes
2. **P2 (Coach buttons fit on screen)** — CSS-only, ~15 property changes
3. **P3 (Button consistency)** — CSS-only, ~10 property changes
4. **P4 (Color tokens)** — CSS-only, variable definitions + ~65 replacements
5. **P5 (Header/scoreboard)** — CSS-only, ~3 additions
6. **P6 (Dashboard density)** — CSS-only, ~8 property changes
7. **P7 (Auth polish)** — CSS-only, ~4 property changes
8. **P8 (Spectator)** — CSS-only, ~3 additions
9. **P9 (Transitions)** — CSS-only, ~3 property changes
10. **P10 (Modals)** — CSS-only, ~2 property changes + 1 new rule

**Total: ~0 HTML changes, ~130 CSS property changes, ~65 color token replacements.**
**All changes are CSS-only. No JavaScript modifications. No structural HTML changes.**
