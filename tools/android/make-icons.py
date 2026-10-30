#!/usr/bin/env python3
"""GymQuest / Gym-Lift — Android ikony a splash z icon-512.png (Pillow, bez ďalších nástrojov).

    python3 tools/android/make-icons.py

Zapisuje do android/app/src/main/res: mipmap-*/ic_launcher*.png (adaptívna aj stará ikona),
drawable*/splash.png (Android < 12), drawable-*/ic_splash_icon.png (Android 12+ splash) a
drawable-*/ic_stat_gq.png (biela silueta pre notifikácie). Pozadie = farba pozadia ikony.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
SRC = Image.open(os.path.join(ROOT, 'icon-512.png')).convert('RGBA')
BG = SRC.getpixel((5, 5))[:3]                       # pozadie ikony (farba v rohu)
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def glyph():
    """Činka bez pozadia, orezaná na svoj obrys."""
    out = Image.new('RGBA', SRC.size, (0, 0, 0, 0))
    px, po = SRC.load(), out.load()
    for y in range(SRC.height):
        for x in range(SRC.width):
            r, g, b, a = px[x, y]
            d = abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2])
            if d > 60:
                po[x, y] = (r, g, b, min(255, int(a * min(1.0, (d - 60) / 120 + 0.2))))
    return out.crop(out.getbbox())


GLYPH = glyph()


def centered(size, frac, bg=None, img=GLYPH):
    """Plátno size×size, glyf zmenšený na frac šírky, v strede."""
    c = Image.new('RGBA', (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    w = max(1, round(size * frac))
    h = max(1, round(w * img.height / img.width))
    g = img.resize((w, h), Image.LANCZOS)
    c.alpha_composite(g, ((size - w) // 2, (size - h) // 2))
    return c


def save(img, sub, name):
    d = os.path.join(RES, sub)
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, name), optimize=True)


def rounded(img, radius_frac):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1),
                                        radius=round(img.width * radius_frac), fill=255)
    out = img.copy()
    out.putalpha(m)
    return out


for name, k in DENS.items():
    # adaptívna ikona: 108dp, viditeľných ~72dp; glyf (nápis) na 34 % = rovnaký pomer ako v návrhu
    # (nápis ≈ 51 % ikony) a aj rohy textu ostanú vnútri kruhovej masky (polomer 33dp)
    save(centered(round(108 * k), 0.34), 'mipmap-' + name, 'ic_launcher_foreground.png')
    # stará ikona (Android < 8) = presne návrh, len zaoblený / kruhový
    full = SRC.resize((round(48 * k), round(48 * k)), Image.LANCZOS)
    save(rounded(full, 0.18), 'mipmap-' + name, 'ic_launcher.png')
    circ = Image.new('L', full.size, 0)
    ImageDraw.Draw(circ).ellipse((0, 0, full.width - 1, full.height - 1), fill=255)
    rnd = full.copy()
    rnd.putalpha(circ)
    save(rnd, 'mipmap-' + name, 'ic_launcher_round.png')
    # Android 12+ splash ikona (240dp plátno, ikona v kruhu 160dp → nápis na 42 %, rohy vnútri kruhu)
    save(centered(round(240 * k), 0.42), 'drawable-' + name, 'ic_splash_icon.png')
    # notifikácia: biela silueta 24dp
    white = Image.new('RGBA', GLYPH.size, (255, 255, 255, 255))
    white.putalpha(GLYPH.getchannel('A'))
    save(centered(round(24 * k), 0.92, img=white), 'drawable-' + name, 'ic_stat_gq.png')
    # Android < 12: celoobrazovkový splash
    for orient, (w, h) in (('port', (320, 480)), ('land', (480, 320))):
        s = Image.new('RGBA', (round(w * k), round(h * k)), BG + (255,))
        g = centered(round(min(w, h) * k), 0.45)
        s.alpha_composite(g, ((s.width - g.width) // 2, (s.height - g.height) // 2))
        save(s, 'drawable-%s-%s' % (orient, name), 'splash.png')

base = Image.new('RGBA', (480, 480), BG + (255,))
base.alpha_composite(centered(480, 0.45))
save(base, 'drawable', 'splash.png')

with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % BG)
print('icons + splash written, background #%02X%02X%02X' % BG)
