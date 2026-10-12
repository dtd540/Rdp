"""Generate SPOTT's gold HUD mark at Windows and tray resolutions."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
PUBLIC = ROOT / 'app' / 'renderer' / 'public'
BUILD.mkdir(exist_ok=True)
PUBLIC.mkdir(exist_ok=True)


def render(size):
    scale = 4
    n = size * scale
    image = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    gold = (255, 191, 47, 255)
    # Transparent corners; a dark circular face keeps the mark legible on any taskbar.
    draw.ellipse((n*.04, n*.04, n*.96, n*.96), fill=(20, 5, 10, 255))
    stroke = max(scale, round(n * .022))
    if size >= 24:
        for angle in range(0, 360, 24):
            draw.arc((n*.075, n*.075, n*.925, n*.925), angle, angle+10,
                     fill=gold, width=max(scale, round(n*.015)))
    draw.ellipse((n*.19, n*.19, n*.81, n*.81), outline=gold, width=stroke)
    points = [(n*.5, n*.29), (n*.70, n*.66), (n*.30, n*.66), (n*.5, n*.29)]
    draw.line(points, fill=gold, width=stroke, joint='curve')
    draw.ellipse((n*.44, n*.46, n*.56, n*.58), fill=gold)
    if size >= 48:
        glow = image.copy()
        alpha = glow.getchannel('A').point(lambda a: round(a*.22))
        glow.putalpha(alpha)
        glow = glow.filter(ImageFilter.GaussianBlur(n*.018))
        image = Image.alpha_composite(glow, image)
    return image.resize((size, size), Image.Resampling.LANCZOS)


sizes = [16, 24, 32, 48, 64, 128, 256]
icon = render(256)
icon.save(BUILD / 'spott.ico', sizes=[(s, s) for s in sizes],
          append_images=[render(s) for s in sizes[:-1]])
render(512).save(BUILD / 'spott.png')
render(32).save(BUILD / 'spott-tray.png')
render(32).save(PUBLIC / 'favicon.png')
print('Generated build/spott.ico, build/spott.png, build/spott-tray.png and preview favicon')
