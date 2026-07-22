#!/usr/bin/env python3
"""P3.4a — Bake the Ice-themed share-preview assets.

Generates the sprite set consumed by renderPreviewPng() in
api/_spectator-share-lib.js (and dev_server.py's Python mirror):

  api/_share-assets/template.png        1200x630 Ice template (band texture,
                                        glass scoreboard card, empty crest
                                        slots, period pill slot, lockup)
  api/_share-assets/pill-live.png       LIVE pill (green gradient + glow)
  api/_share-assets/pill-soon.png       STARTING SOON pill (gray glass)
  api/_share-assets/pill-final.png      FINAL pill (gray glass)
  api/_share-assets/glyphs-score.png    Saira Black digits 0-9, ~96px cap, white
  api/_share-assets/glyphs-lg.png       Saira Black A-Z 0-9, ~44px cap, white
  api/_share-assets/glyphs-sm.png       Hanken Bold A-Z 0-9, ~21px cap, white
  api/_share-assets/manifest.json       dimensions, glyph metrics, layout slots

All sprites are standard 8-bit RGBA PNGs (what the minimal JS decoder
expects: color type 6, bit depth 8, non-interlaced). Tinted variants are
produced at composite time by channel multiplication, so only white/neutral
art is baked.

Run from anywhere:  python3 outputs/brand/share-template/bake_share_assets.py
Requires Pillow (PIL) with WEBP support and the brand masters in
outputs/brand/ (fonts, ice-texture-band-1920.webp, lockup master).
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
BRAND = ROOT / "outputs" / "brand"
OUT = ROOT / "api" / "_share-assets"

FONT_SAIRA_BLACK = BRAND / "fonts" / "SairaSemiCondensed-Black.ttf"
FONT_HANKEN_BOLD = BRAND / "fonts" / "HankenGrotesk-Bold.ttf"
TEXTURE_BAND = BRAND / "ice-texture-band-1920.webp"
LOCKUP = BRAND / "lockup" / "lockup-master-transparent.png"

W, H = 1200, 630

# Layout slots (shared with the JS/Python compositors via manifest.json).
LAYOUT = {
    "card": {"x": 90, "y": 64, "w": 1020, "h": 386, "r": 30},
    "pill": {"x": 118, "y": 94, "h": 48},
    "crest": {"w": 110, "h": 118, "top": 152},
    "them": {"cx": 330},
    "us": {"cx": 870},
    "labelCapCy": 302,
    "scoreCapCy": 384,
    "period": {"cx": 600, "cy": 254, "w": 150, "h": 104},
}

# Ice palette (design/spectator-ice.html)
INK = (238, 244, 250)
MUTED = (194, 206, 221)
LINE_A = 41  # rgba(255,255,255,.16)
CARD_FILL = (11, 17, 28, 182)  # glass: darker than rgba(9,14,24,.82) reads on print, lets ice through
CREST_THEM = ((58, 70, 84), (38, 46, 58))  # #3a4654 -> #262e3a
CREST_US = ((42, 95, 214), (22, 58, 134))  # #2a5fd6 -> #163a86
LIVE_GRAD = ((39, 209, 124), (22, 168, 98))  # #27D17C -> #16A862
LIVE_TEXT = (4, 33, 15)


def font_for_cap(path: Path, target_cap: int) -> ImageFont.FreeTypeFont:
    """Pick the point size whose capital-height ('H') is closest to target."""
    best, best_err = None, 1e9
    for size in range(8, 260):
        font = ImageFont.truetype(str(path), size)
        bbox = font.getbbox("H")
        cap = bbox[3] - bbox[1]
        err = abs(cap - target_cap)
        if err < best_err:
            best, best_err = font, err
        if cap > target_cap + 6:
            break
    return best


def vgradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    w, h = size
    img = Image.new("RGBA", size)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        col = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        a_top = top[3] if len(top) > 3 else 255
        a_bot = bottom[3] if len(bottom) > 3 else 255
        a = round(a_top + (a_bot - a_top) * t)
        for x in range(w):
            px[x, y] = (*col, a)
    return img


def hgradient(size: tuple[int, int], left: tuple, right: tuple) -> Image.Image:
    return vgradient((size[1], size[0]), left, right).rotate(-90, expand=True)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def paste_shadow(base: Image.Image, box: tuple[int, int, int, int], radius: int,
                 blur: int, alpha: int, dy: int = 0) -> None:
    x, y, w, h = box
    pad = blur * 3
    shadow = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad, pad + w - 1, pad + h - 1), radius=radius,
                                             fill=(0, 0, 0, alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow, (x - pad, y - pad + dy))


def build_background() -> Image.Image:
    tex = Image.open(TEXTURE_BAND).convert("RGB")
    tw, th = tex.size  # 1920x1080
    crop_h = round(tw * H / W)
    top = max(0, (th - crop_h) // 2)
    bg = tex.crop((0, top, tw, top + crop_h)).resize((W, H), Image.LANCZOS)
    bg = bg.point(lambda v: min(255, round(v * 1.16)))  # lift the dark band a touch
    # Soften texture grain: keeps the icy character but drops PNG entropy so the
    # dynamic endpoint stays under the 300 KB response budget.
    bg = bg.filter(ImageFilter.GaussianBlur(2.2))
    bg = bg.convert("RGBA")

    # Top ice bloom (spectator .topbloom)
    bloom = Image.radial_gradient("L").resize((900, 520))
    bloom = bloom.point(lambda v: max(0, 255 - v * 2))  # bright center falloff
    bloom_img = Image.new("RGBA", bloom.size, (235, 244, 252, 0))
    bloom_img.putalpha(bloom.point(lambda v: v * 34 // 255))
    bg.alpha_composite(bloom_img, (W // 2 - 450, -260))

    # Soft vignette so the card pops
    vin = Image.radial_gradient("L").resize((W + 400, H + 400))
    vin = vin.point(lambda v: v * 48 // 255)
    dark = Image.new("RGBA", vin.size, (2, 5, 10, 0))
    dark.putalpha(vin)
    bg.alpha_composite(dark, (-200, -200))
    return bg


def draw_glass_card(bg: Image.Image) -> None:
    c = LAYOUT["card"]
    x, y, w, h, r = c["x"], c["y"], c["w"], c["h"], c["r"]
    paste_shadow(bg, (x, y, w, h), r, blur=18, alpha=150, dy=14)

    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=CARD_FILL)

    # Inner top glow (glass sheen)
    glow = vgradient((w, 90), (255, 255, 255, 26), (255, 255, 255, 0))
    sheen = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sheen.alpha_composite(glow, (0, 0))
    mask = rounded_mask((w, h), r)
    card.alpha_composite(Image.composite(sheen, Image.new("RGBA", (w, h), (0, 0, 0, 0)), mask))

    # Border + top highlight line
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=r, outline=(255, 255, 255, LINE_A), width=2)
    hl = hgradient((w - 2 * r, 2), (255, 255, 255, 0), (255, 255, 255, 115))
    hl_right = hgradient((w - 2 * r, 2), (255, 255, 255, 115), (255, 255, 255, 0))
    half = (w - 2 * r) // 2
    card.alpha_composite(hl.crop((0, 0, half, 2)), (r, 1))
    card.alpha_composite(hl_right.crop((hl_right.width - (w - 2 * r - half), 0, hl_right.width, 2)), (r + half, 1))

    bg.alpha_composite(card, (x, y))


def draw_crest_slot(bg: Image.Image, cx: int, grad: tuple, glow_color: tuple | None) -> None:
    cw, ch, top = LAYOUT["crest"]["w"], LAYOUT["crest"]["h"], LAYOUT["crest"]["top"]
    x = cx - cw // 2
    if glow_color:
        pad = 40
        glow = Image.new("RGBA", (cw + pad * 2, ch + pad * 2), (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle((pad, pad, pad + cw - 1, pad + ch - 1), radius=28,
                                               fill=(*glow_color, 110))
        glow = glow.filter(ImageFilter.GaussianBlur(16))
        bg.alpha_composite(glow, (x - pad, top - pad + 10))
    else:
        paste_shadow(bg, (x, top, cw, ch), 28, blur=10, alpha=110, dy=8)

    crest = vgradient((cw, ch), (*grad[0], 255), (*grad[1], 255))
    mask = rounded_mask((cw, ch), 28)
    crest.putalpha(mask)
    d = ImageDraw.Draw(crest)
    d.rounded_rectangle((0, 0, cw - 1, ch - 1), radius=28, outline=(255, 255, 255, LINE_A), width=2)
    d.rounded_rectangle((20, 3, cw - 21, 6), radius=2, fill=(255, 255, 255, 102))  # top gloss bar
    bg.alpha_composite(crest, (x, top))


def draw_period_slot(bg: Image.Image) -> None:
    p = LAYOUT["period"]
    w, h = p["w"], p["h"]
    x, y = p["cx"] - w // 2, p["cy"] - h // 2
    box = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=20, fill=(255, 255, 255, 22))
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=20, outline=(255, 255, 255, LINE_A), width=2)
    bg.alpha_composite(box, (x, y))


def place_lockup(bg: Image.Image) -> None:
    lockup = Image.open(LOCKUP).convert("RGBA")
    lw = 400
    lh = round(lockup.size[1] * lw / lockup.size[0])
    lockup = lockup.resize((lw, lh), Image.LANCZOS)
    bg.alpha_composite(lockup, (W // 2 - lw // 2, 540 - lh // 2))


def bake_pill(text: str, kind: str) -> tuple[Image.Image, dict]:
    """Pill sprite with baked glow margin. Returns (image, meta)."""
    font = font_for_cap(FONT_HANKEN_BOLD, 19)
    tracking = 5
    adv = sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)
    dot_r = 6
    pad_x = 24
    h = LAYOUT["pill"]["h"]
    dot_span = (dot_r * 2 + 12) if kind == "live" else 0
    w = round(adv) + pad_x * 2 + dot_span
    margin = 18
    img = Image.new("RGBA", (w + margin * 2, h + margin * 2), (0, 0, 0, 0))

    pill_box = (margin, margin, margin + w - 1, margin + h - 1)
    if kind == "live":
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle(pill_box, radius=h // 2, fill=(31, 184, 128, 150))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10)))
        grad = hgradient((w, h), (*LIVE_GRAD[0], 255), (*LIVE_GRAD[1], 255))
        grad.putalpha(rounded_mask((w, h), h // 2))
        img.alpha_composite(grad, (margin, margin))
        text_col = LIVE_TEXT
    else:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(pill_box, radius=h // 2, fill=(20, 28, 42, 235))
        d.rounded_rectangle(pill_box, radius=h // 2, outline=(255, 255, 255, 51), width=2)
        text_col = MUTED if kind == "soon" else INK

    d = ImageDraw.Draw(img)
    bbox = font.getbbox("H")
    cap_cy = margin + h // 2
    ty = cap_cy - (bbox[1] + bbox[3]) / 2
    tx = margin + pad_x
    if kind == "live":
        d.ellipse((tx, cap_cy - dot_r, tx + dot_r * 2, cap_cy + dot_r), fill=text_col)
        tx += dot_r * 2 + 12
    for ch in text:
        d.text((tx, ty), ch, font=font, fill=(*text_col, 255))
        tx += font.getlength(ch) + tracking
    return img, {"w": img.size[0], "h": img.size[1], "margin": margin}


def bake_sheet(font_path: Path, chars: str, target_cap: int) -> tuple[Image.Image, dict]:
    font = font_for_cap(font_path, target_cap)
    ascent, descent = font.getmetrics()
    height = ascent + descent
    pad = 3
    cells = {}
    cursor = 0
    measures = []
    for ch in chars:
        bbox = font.getbbox(ch)
        ink_w = max(1, bbox[2] - bbox[0])
        cell_w = ink_w + pad * 2
        measures.append((ch, bbox, cell_w))
        cursor += cell_w
    sheet = Image.new("RGBA", (cursor, height), (255, 255, 255, 0))
    d = ImageDraw.Draw(sheet)
    x = 0
    for ch, bbox, cell_w in measures:
        d.text((x + pad - bbox[0], 0), ch, font=font, fill=(255, 255, 255, 255))
        cells[ch] = {
            "x": x,
            "w": cell_w,
            "dx": bbox[0] - pad,        # cell left relative to pen position
            "adv": round(font.getlength(ch), 2),
        }
        x += cell_w
    hbox = font.getbbox("H")
    meta = {
        "w": sheet.size[0],
        "h": sheet.size[1],
        "capTop": hbox[1],
        "capBottom": hbox[3],
        "chars": cells,
    }
    return sheet, meta


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    bg = build_background()
    draw_glass_card(bg)
    draw_crest_slot(bg, LAYOUT["them"]["cx"], CREST_THEM, None)
    draw_crest_slot(bg, LAYOUT["us"]["cx"], CREST_US, (47, 111, 237))
    draw_period_slot(bg)
    place_lockup(bg)
    bg.save(OUT / "template.png", optimize=True)

    manifest = {
        "version": 1,
        "template": {"file": "template.png", "w": W, "h": H},
        "layout": LAYOUT,
        "pills": {},
        "sheets": {},
    }

    for kind, text in (("live", "LIVE"), ("soon", "STARTING SOON"), ("final", "FINAL")):
        img, meta = bake_pill(text, kind)
        name = f"pill-{kind}.png"
        img.save(OUT / name, optimize=True)
        manifest["pills"][kind] = {"file": name, **meta}

    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    for key, font_path, chars, cap in (
        ("score", FONT_SAIRA_BLACK, "0123456789", 96),
        ("lg", FONT_SAIRA_BLACK, letters, 44),
        ("sm", FONT_HANKEN_BOLD, letters + ".-'&", 21),
    ):
        sheet, meta = bake_sheet(font_path, chars, cap)
        name = f"glyphs-{key}.png"
        sheet.save(OUT / name, optimize=True)
        manifest["sheets"][key] = {"file": name, **meta}

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.iterdir())
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:24} {f.stat().st_size / 1024:8.1f} KB")
    print(f"{'TOTAL':24} {total / 1024:8.1f} KB")


if __name__ == "__main__":
    main()
