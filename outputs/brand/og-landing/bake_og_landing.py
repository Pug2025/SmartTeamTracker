#!/usr/bin/env python3
"""Bake the 1200x630 social link-preview (og:image) for the app's landing URL.

This is the card that renders in iMessage/WhatsApp/etc. when the app link itself
is shared (as opposed to a spectator link). Static, baked once. Regenerate:
    python3 outputs/brand/og-landing/bake_og_landing.py
Output -> assets/share/og-landing-1200x630.png
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
W, H = 1200, 630

TEXTURE = os.path.join(ROOT, "assets/brand/ice-texture-dark-1920.webp")
LOCKUP = os.path.join(ROOT, "outputs/brand/lockup/lockup-master-transparent.png")
FONT_DIR = os.path.join(ROOT, "outputs/brand/fonts")
SAIRA_XB = os.path.join(FONT_DIR, "SairaSemiCondensed-ExtraBold.ttf")
HANKEN = os.path.join(FONT_DIR, "HankenGrotesk-Bold.ttf")
OUT = os.path.join(ROOT, "assets/share/og-landing-1200x630.png")

TEAL = (23, 182, 200)
INK = (238, 244, 250)
MUTE = (176, 190, 208)

# --- background: cover-fit the dark ice texture ---
tex = Image.open(TEXTURE).convert("RGB")
scale = max(W / tex.width, H / tex.height)
tex = tex.resize((round(tex.width * scale), round(tex.height * scale)), Image.LANCZOS)
left = (tex.width - W) // 2
top = (tex.height - H) // 2
card = tex.crop((left, top, left + W, top + H)).convert("RGBA")

# --- darkening wash (top->bottom) so the lockup + type stay legible ---
wash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
wd = ImageDraw.Draw(wash)
for y in range(H):
    t = y / H
    a = int(150 + 90 * t)  # 150 -> 240
    wd.line([(0, y), (W, y)], fill=(6, 11, 20, a))
card = Image.alpha_composite(card, wash)

draw = ImageDraw.Draw(card)

# --- lockup (chrome), the undisputed hero; sized to dominate the frame ---
lock = Image.open(LOCKUP).convert("RGBA")
lw = 880              # 660 -> 880: the logo must clearly outrank the copy
lh = round(lock.height * (lw / lock.width))
lock = lock.resize((lw, lh), Image.LANCZOS)

# --- type + tunables (dialed down so the lockup wins the hierarchy) ---
tag = "LIVE HOCKEY STAT TRACKING"
f_tag = ImageFont.truetype(SAIRA_XB, 44)   # 52 -> 44
sub = "Shots · Goals · Saves · Goalie & Team Scores"
f_sub = ImageFont.truetype(HANKEN, 26)     # 28 -> 26

RULE_H = 4          # teal accent rule thickness
GAP_LOCK_RULE = 40  # lockup bottom -> rule
GAP_RULE_TAG = 40   # rule -> tagline ink top
GAP_TAG_SUB = 26    # tagline ink bottom -> subline ink top
OPTICAL_BIAS = -10  # nudge the whole block up so it reads optically centered

# measured ink heights so the stack is centered by what the eye actually sees
tb = draw.textbbox((0, 0), tag, font=f_tag)
tag_top, tag_h = tb[1], tb[3] - tb[1]
sb = draw.textbbox((0, 0), sub, font=f_sub)
sub_top, sub_h = sb[1], sb[3] - sb[1]

block_h = (lh + GAP_LOCK_RULE + RULE_H + GAP_RULE_TAG
           + tag_h + GAP_TAG_SUB + sub_h)
block_top = (H - block_h) / 2 + OPTICAL_BIAS

# --- teal glow, centered behind the lockup as a hero halo ---
lock_cy = block_top + lh / 2
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W / 2 - 500, lock_cy - 310, W / 2 + 500, lock_cy + 310],
           fill=(23, 182, 200, 62))
glow = glow.filter(ImageFilter.GaussianBlur(90))
card = Image.alpha_composite(card, glow)
draw = ImageDraw.Draw(card)

# --- place the block, top-down ---
lock_y = round(block_top)
card.alpha_composite(lock, ((W - lw) // 2, lock_y))

rule_cy = lock_y + lh + GAP_LOCK_RULE + RULE_H / 2
draw.line([(W / 2 - 48, rule_cy), (W / 2 + 48, rule_cy)], fill=TEAL, width=RULE_H)


def draw_tracked(d, text, font, ink_top, fill, tracking):
    """Draw centered, letter-tracked text with its ink top at ink_top."""
    widths = [d.textbbox((0, 0), ch, font=font)[2] for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (W - total) / 2
    y = ink_top - tag_top  # lift so the ink cap-line lands on ink_top
    for ch, wch in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += wch + tracking


tag_ink_top = rule_cy + RULE_H / 2 + GAP_RULE_TAG
draw_tracked(draw, tag, f_tag, tag_ink_top, INK, 6)

# --- subline (Hanken) ---
sub_ink_top = tag_ink_top + tag_h + GAP_TAG_SUB
sw = draw.textbbox((0, 0), sub, font=f_sub)[2]
draw.text(((W - sw) / 2, sub_ink_top - sub_top), sub, font=f_sub, fill=MUTE)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
card.convert("RGB").save(OUT, "PNG", optimize=True)
print("wrote", OUT, Image.open(OUT).size, f"{os.path.getsize(OUT)//1024}KB")
