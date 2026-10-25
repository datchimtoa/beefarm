#!/usr/bin/env python3
"""Generate the honey-drop currency icon as a PNG.

The wool.png it replaces was 32x34 and drawn for the sheep skin. No image
libraries exist on this host and the logo is a JPEG (which would need a full
decoder), so the icon is drawn procedurally instead of cropped from artwork.

Output is RGBA at 64x64 — rendered between 14 and 32 px in the UI — with a
transparent background and the same outline weight and palette as the bee
sprite (`#5F270A` outline, amber gradient body), so it sits with the mascot
rather than looking pasted on.

  python3 scripts/make-currency-icon.py
"""
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps' / 'web' / 'public' / 'currency.png'
SIZE = 64
SS = 3  # supersample factor, for smooth edges without antialiasing libraries

OUTLINE = (95, 39, 10, 255)      # #5F270A, the game's outline brown
HONEY_LIGHT = (255, 214, 89, 255)  # #FFD659
HONEY_MID = (244, 180, 0, 255)     # #F4B400
HONEY_DARK = (216, 145, 0, 255)
SHINE = (255, 246, 214, 190)


def drop_contains(x, y, size):
    """A teardrop: a circle whose top is pulled into a point."""
    # Normalised coordinates, origin at the drop's centre.
    cx, cy = size / 2, size * 0.60
    r = size * 0.30
    dx, dy = x - cx, y - cy

    if dy >= 0:                       # round bottom
        return math.hypot(dx, dy) <= r
    # Tapered top: width shrinks linearly to a point at the tip.
    tip_y = size * 0.14
    if y < tip_y:
        return False
    t = (y - tip_y) / (cy - tip_y)    # 0 at tip, 1 at the circle's centre line
    return abs(dx) <= r * (t ** 0.62)


def sample(x, y, size):
    """Colour at a point, or None when outside the drop."""
    if not drop_contains(x, y, size):
        return None
    cx, cy = size / 2, size * 0.60
    r = size * 0.30

    # Outline: a constant-width stroke following the silhouette, so the bottom
    # is not thicker than the sides.
    stroke = size * 0.045
    if y >= cy:
        if math.hypot(x - cx, y - cy) > r - stroke:
            return OUTLINE
    else:
        tip_y = size * 0.14
        t = (y - tip_y) / (cy - tip_y)
        half = r * (max(0.0, t) ** 0.62)
        if abs(x - cx) > half - stroke or y < tip_y + stroke:
            return OUTLINE

    # Vertical gradient: light at the top, deeper amber at the bottom.
    t = max(0.0, min(1.0, (y - size * 0.14) / (size * 0.86)))
    if t < 0.5:
        k = t / 0.5
        col = tuple(int(HONEY_LIGHT[i] + (HONEY_MID[i] - HONEY_LIGHT[i]) * k) for i in range(3))
    else:
        k = (t - 0.5) / 0.5
        col = tuple(int(HONEY_MID[i] + (HONEY_DARK[i] - HONEY_MID[i]) * k) for i in range(3))
    col = col + (255,)

    # Specular highlight, upper-left, so the drop reads as glossy.
    hx, hy = cx - r * 0.42, cy - r * 0.46
    if math.hypot(x - hx, y - hy) < r * 0.26:
        return SHINE
    return col


def render():
    size = SIZE
    big = size * SS
    # Supersampled RGBA buffer: average SS*SS samples per output pixel.
    out = bytearray(size * size * 4)
    for py in range(size):
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size * big
                    y = (py + (sy + 0.5) / SS) / size * big
                    c = sample(x, y, big)
                    if c is None:
                        continue
                    for i in range(4):
                        acc[i] += c[i]
            n = SS * SS
            out[(py * size + px) * 4:(py * size + px) * 4 + 4] = bytes(v // n for v in acc)
    return out


def write_png(path, width, height, rgba):
    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        line = rgba[y * stride:(y + 1) * stride]
        filtered = bytearray(stride)
        for i in range(stride):
            left = line[i - 4] if i >= 4 else 0
            filtered[i] = (line[i] - left) & 0xFF
        raw.append(1)  # Sub
        raw += filtered

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


def main():
    rgba = render()
    write_png(OUT, SIZE, SIZE, rgba)
    opaque = sum(1 for i in range(3, len(rgba), 4) if rgba[i] > 0)
    print(f'wrote {OUT.relative_to(ROOT)}  {SIZE}x{SIZE} RGBA  {OUT.stat().st_size} bytes')
    print(f'  opaque pixels: {opaque} ({opaque / (SIZE * SIZE) * 100:.0f}%)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
