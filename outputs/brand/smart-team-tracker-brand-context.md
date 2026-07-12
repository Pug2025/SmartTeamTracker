# Smart Team Tracker — Brand Context Document

This document is the single source of truth for anyone (human or AI) creating brand assets for Smart Team Tracker. Read it fully before producing anything.

---

## 1. What the product is

**Smart Team Tracker** is a Progressive Web App (PWA) for ice hockey coaches. It is used **live, rink-side, from the bench** during real games to track shots, goals, saves, scoring chances, and other in-game events with one-tap speed. From that data it generates performance scores for goalies and teams, season-long dashboards, and opponent records.

Official tagline (from the app manifest):
> "Rink-side stat tracking for hockey coaches. Track shots, goals, saves, and more — live from the bench."

Key capabilities:
- **Live game tracking** — one-tap logging of shots, goals, saves, and scoring chances while the game is happening. Speed and glanceability are everything; coaches use it with cold hands, standing behind a bench.
- **Performance scoring** — computed goalie and team performance scores (save percentage, scoring-chance quality, etc.) that turn raw taps into credible, digestible ratings.
- **Spectator share** — parents and fans get a real-time link to follow the game live from the stands or from home. This is the product's built-in growth loop: every shared game is a demo.
- **Season tools** — season dashboard, team manager, multi-season history, opponent records.

## 2. Product name — non-negotiable

The name is **Smart Team Tracker** — always three words, each capitalized. Never "Team Tracker", never "SmartTeamTracker" in customer-facing copy (the one-word form appears only in code/URLs), never "STT" as a primary lockup (an "STT" monogram is acceptable as a *secondary* mark or app-icon glyph if a full wordmark won't fit).

## 3. Audience

- **Primary:** amateur/minor hockey coaches — youth leagues, junior teams, beer leagues. Mostly volunteer or semi-pro coaches, ages ~30–55, in Canada and the northern US. They are hockey people first, tech people second.
- **Secondary:** hockey parents and fans using the spectator view on their phones in cold arenas.
- **Tertiary (future):** goalies and players reviewing their own performance scores.

The brand must feel at home in an arena: taped sticks, cold rinks, coffee in the lobby — not a Silicon Valley analytics dashboard. But it also has to signal *credible data*, because the performance scores are only valuable if they feel trustworthy.

## 4. Business context

- Currently free; being prepared for a paid SaaS launch (freemium: free tier + paid subscription). Brand assets should feel professional enough to charge money for, but approachable enough for a volunteer coach to trust instantly.
- Solo-built product. No existing logo — the brand is being created from scratch. There is no legacy asset to preserve except the in-app color language below.
- Distribution is web-first (installable PWA), so app icons, favicon, and social/link-preview images matter more than app-store assets.

## 5. Existing visual language (the app UI today)

The app is **dark-mode only** and the brand should embrace that:

| Token | Hex | Role |
|---|---|---|
| Background | `#000000` | App background (true black, OLED-friendly) |
| Panel | `#111111` | Cards/surfaces |
| Ink | `#FFFFFF` | Primary text |
| Muted | `#888888` | Secondary text |
| **Accent — Us (blue)** | `#4DA3FF` | The home team, positive actions — the closest thing to a brand color today |
| Accent — Them (red) | `#FF453A` | The opponent |
| Good (green) | `#32D74B` | Positive stats |
| Warn (amber) | `#FF9F0A` | Caution stats |

The blue `#4DA3FF` on black is the de facto brand feel. The new brand system may refine or replace these, but must stay harmonious with a black-background app and must keep blue = us / red = them legible, since that duality is core to the live-tracking UI.

## 6. Brand personality

Aim for these five traits, in order of priority:

1. **Fast** — built for live, in-the-moment use. Nothing ornate or slow-feeling.
2. **Trustworthy** — the scores must read as credible math, not gimmicks.
3. **Hockey-native** — unmistakably about hockey (ice, rink lines, pucks, sticks, goal lights are fair-game motifs) without being a cartoon mascot brand.
4. **Modern-dark** — sharp, high-contrast, at home on an OLED phone screen at ice level.
5. **Approachable** — a volunteer coach should feel "this is for me," not "this is for an NHL analytics department."

**Approved style direction:** bold, dimensional, sports-badge energy — beveled chrome/silver lettering with glossy blue accents, italic/forward-leaning wordmark, hockey-stick integrated into the lockup. The approved reference is the existing "Smart Team Tracker" chrome logo (silver SMART/TRACKER, glossy blue TEAM, stick sweeping through). New assets must match that style; do NOT flatten it into minimalist geometry.

Avoid: flat corporate-SaaS minimalism, mascots/snarling animals/flames, anything that only works on white backgrounds, thin hairline details that vanish at 16 px.

## 7. Assets needed

In priority order:

1. **Logo system**
   - Primary logo: icon + "Smart Team Tracker" wordmark lockup (horizontal)
   - Standalone icon/glyph that works alone at small sizes
   - Stacked/vertical lockup for square placements
   - Mono (single-color white) and dark-on-light fallback versions
2. **App icons** — 512×512 and 192×192 PNG (PWA manifest), plus a maskable-safe version (all critical detail inside the central 80% safe zone), and a 32×32-legible favicon
3. **Color palette** — refined brand palette that harmonizes with the existing UI tokens in §5; specify hex values and usage rules
4. **Typography** — a display/wordmark treatment plus recommended UI-adjacent font pairing (must include a free/Google-Fonts option, since this is a web app)
5. **Social / link-preview (Open Graph) image** — 1200×630, used when coaches share spectator links; this is seen by parents constantly, so it doubles as an ad
6. **Landing-page hero direction** — visual concept for the marketing/landing page (dark theme)
7. **Brand one-pager** — a short usage sheet: clear-space rules, minimum sizes, do/don't examples

## 8. Hard constraints

- **Small-size legibility is the #1 test.** The icon must be readable at 32 px on a phone home screen and as a favicon. If a concept fails at 32 px, it fails.
- Logo must work on pure black (`#000000`) first; light-background version is secondary.
- **Every deliverable needs a transparent background** (PNG with alpha) — never baked onto white.
- Portrait-phone context: most users only ever see this brand on a phone screen.
- No mascots, no photorealistic renders as the primary mark. Gradients/bevels in the approved chrome style are fine; keep them smooth (no banding) and simplify detail at small sizes.
- The word "Smart" must not visually dominate — the emphasis balance across the three words should be even, or lean on "Team Tracker" with "Smart" as the modifier.

## 9. Motifs worth exploring (suggestions, not requirements)

- Rink geometry: center-ice circle, blue lines, goal crease — clean line-work that doubles as data-viz language
- The shot/goal moment: a puck trajectory, a goal-light glow
- A tally/stat mark: the act of counting made visual (tick marks, a rising bar that is also a hockey stick blade)
- An "S/T/T" monogram built from rink lines

The strongest direction likely fuses **rink geometry with data/stat visualization** — that intersection *is* the product.
