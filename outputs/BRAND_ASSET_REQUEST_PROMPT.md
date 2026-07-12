# Brand asset production prompt — Smart Team Tracker

*Paste everything below the line into GPT 5.6. First attach the reference files listed in §2 (they live in the SmartTeamTracker repo at the paths shown). Deliver finished assets to `outputs/brand/` using the exact filenames in §4.*

---

You are producing the brand asset library for **Smart Team Tracker** — a mobile-first web app (PWA) for youth/junior hockey. Coaches track shots, goals, and saves live from the bench; the app computes 0–100 Goalie and Team performance scores; parents and family follow games in real time through a shared live link. The product's voice: **broadcast-quality, ice-cold, analytically credible** — "arena scoreboard meets modern sports analytics," never cartoonish, never corporate-generic. Tagline in use: *"Know how your team really played."* The product name is always three words: **Smart Team Tracker** (never "SmartTeamTracker").

## 1. Locked design language ("Ice") — all assets must conform

**Palette (exact, do not drift):**
- Brand accent (the ONLY brand color): teal `#17B6C8`, glow variant `#36E0F0`
- Team-data colors (never used as brand): US blue `#2F6FED`, THEM red `#DB3B4B`
- Semantic: win green `#1FB880`, warn amber `#F4A627`
- Dark surfaces assets must sit on: page `#05070C`, card `#0C1219`, raised `#141C26`
- Text tones: ink `#EEF4FA`, muted `#C2CEDD`

**Typography:** display face is **Saira Semi Condensed** (weights 700–900) — condensed, sharp, scoreboard-like; UI face is **Hanken Grotesk** (600–800). Any lettering inside assets should match Saira Semi Condensed 800 or be a custom drawing in the same spirit (condensed, slightly aggressive, athletic).

**Component vocabulary already in the product** (assets should rhyme with these): "glass" cards — dark translucent panels `rgba(9,14,24,0.9)` with 1px `rgba(255,255,255,0.16)` hairline borders, 22px radius, a thin white top-highlight line; team "crests" — 50×54px rounded shields (border-radius 13px top / 15px bottom) with 2-letter initials; icons — single-stroke outline style, 2px stroke, round caps (Lucide-compatible); photographic top-down rink ice as the hero texture.

## 2. Reference files to attach (from the SmartTeamTracker repo)

1. **`design/spectator-ice.html`** (may still be at repo root as `Spectator Ice.html`) — the approved design study. Open it in a browser and screenshot it, or read the CSS: it is the definitive reference for the glass cards, crest shapes, LIVE pill, palette in context, and overall mood every asset must match.
2. **`assets/rink-ice.png`** (may still be at repo root as `rink-ice.png`) — the approved 682×1372 top-down rink photograph. This is the color-grading and texture reference: cool blue-white ice (`#0A0F18` shadows), red/blue rink markings, soft arena light blooms. Assets 4, 5, and 7 below must sit in the same photographic family.
3. Optional context: `index.html` (marketing landing copy, for tone) and `manifest.json` (the app is installed to phone home screens — why the icon specs below matter).

## 3. Global constraints (apply to every asset)

- Must be legible/attractive on the dark surfaces above; test every deliverable against `#0C1219`.
- **No identifiable children's faces anywhere** (youth-sports privacy): silhouettes, back-of-jersey numbers, distance shots, or empty-rink scenes only.
- Vector (SVG) where specified; transparent backgrounds unless the spec says otherwise; no drop shadows baked into SVGs (the app applies its own).
- No gradients of more than two stops in logo/mark work; the mark must survive single-color reproduction.
- Deliver with the exact filenames below into `outputs/brand/`.

## 4. Deliverables

### A1 — `logo-mark.svg` + `logo-mark-mono.svg` (highest design effort)
The brand mark, standalone. Square-ish canvas, must stay legible at 16px (favicon) and carry a 512px app icon. Creative territory: the intersection of hockey and insight — e.g., a skate-blade cut forming an "S", a puck as a data point on a trend line, a crest/shield silhouette echoing the product's 13/15px-radius crest component, a stylized rink-corner arc. Teal `#17B6C8` as the only color (plus white/ink). `logo-mark-mono.svg` = identical geometry, pure white `#FFFFFF`. Avoid: hockey-stick clichés crossed like swords, swooshes, generic pulse/heartbeat lines.

### A2 — `logo-lockup-horizontal.svg` + `logo-lockup-stacked.svg`
The mark from A1 + the wordmark "SMART TEAM TRACKER" in Saira Semi Condensed 800 (or custom lettering in that spirit), uppercase, tight tracking. Horizontal version for the app header and landing page; stacked (mark above wordmark) for share cards and the spectator footer. Transparent background; supply in white-text form (dark-surface use is the only use).

### A3 — `icon-master-1024.png`
1024×1024 app icon: the A1 mark centered on a subtle `#0C1219 → #141C26` vertical gradient. **All meaningful content inside the central 80% circle** (Android maskable-icon safe zone). No text. Slight teal glow on the mark is welcome (this is the one place the glow variant `#36E0F0` belongs). The app team derives 512/192/180px and favicon sizes from this file — so no fine 1px details.

### A4 — `hero-rink-wide.png` + `hero-rink-portrait.png`
Landing-page hero photography/illustration: ~2400×1350 (wide) and ~1200×1600 (portrait). Scene: a youth hockey moment that reads at a glance — bench view, coach's gloves and phone, a net silhouette, or empty fresh ice under arena lights. Grade it to match `assets/rink-ice.png`: cool, blue-white, moody, shadows falling to `#0A0F18`. The **left third of the wide version must be clean/low-detail** (headline text overlays there). Remember: no identifiable faces.

### A5 — `share-card-bg-story.png` + `share-card-bg-og.png`
Background frames for auto-generated post-game share cards: 1080×1920 (Instagram/TikTok story) and 1200×630 (link preview/og:image). Ice-texture family of `rink-ice.png`, darkened toward the edges so white/teal text pops; keep the **central ~70% visually quiet** (the app overlays a live scoreboard: crests, score digits, goalie score ring there); small clean zone bottom-center for the A2 stacked lockup. These are the assets parents will post — they should look like a broadcast graphic, not a template.

### A6 (optional) — `empty-states/` — 5 spot illustrations, SVG
`empty-history.svg`, `empty-season.svg`, `empty-players.svg`, `no-connection.svg`, `season-archived.svg`. Style: single-stroke outline, 2px stroke, round caps — the same language as Lucide icons — with teal `#17B6C8` as the only accent color, white strokes otherwise, ~200×160 canvas. Motifs: empty bench, blank scoresheet, jersey on a hook, rink-side wifi, trophy in a case. Witty but restrained; no faces.

### A7 (optional) — `texture-frost-tile.png`
~512×512 **seamless** frost/ice-noise tile, very low contrast, blue-gray on transparent or on `#0A0F18`. Purpose: a pre-baked replacement for a live CSS noise filter if it proves too heavy on low-end phones — so it must tile invisibly and stay subtle enough to sit under text.

## 5. Priority order

**A3 → A1 → A2 → A5 → A4 → A6 → A7.** The icon (A3) unblocks the app-store-quality install experience immediately; the mark (A1) feeds everything else. If iterating, show 3–4 directions for A1 first and lock it before producing A2/A3/A5 from the winner.
