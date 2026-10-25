#!/usr/bin/env python3
"""Remove the plain background from the bee sprite (and similar art).

Both uploaded PNGs are RGB with no alpha, so the bee carries an opaque white box
that shows against the farm background. This makes the background transparent.

Method: flood fill from the image border, not a global colour replace. A global
"make white transparent" would also punch holes through the bee's eyes and the
highlights on its wings, which are near-white and enclosed by dark outlines. The
border fill only reaches connected background, so interior white survives.

No image libraries exist on this host (no PIL, no ImageMagick), so the PNG
decoder/encoder is the same small pure-Python pair used by
scripts/optimize-beeskin.py.

Usage:
  python3 scripts/remove-background.py <in.png> <out.png> [--tolerance 28]
"""
import struct
import sys
import zlib
from collections import deque
from pathlib import Path


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path):
    data = path.read_bytes()
    pos, idat, ihdr = 8, bytearray(), None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', chunk)
        elif ctype == b'IDAT':
            idat += chunk
        pos += 12 + length
    if ihdr is None:
        raise ValueError(f'{path}: no IHDR')
    width, height, depth, colour, _c, _f, interlace = ihdr
    if depth != 8 or colour not in (2, 6) or interlace != 0:
        raise ValueError(
            f'{path}: unsupported PNG (depth={depth} colour={colour} '
            f'interlace={interlace}); expected 8-bit RGB or RGBA, non-interlaced'
        )

    channels = 3 if colour == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                ul = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(left, prev[i], ul)) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def write_png(path, width, height, channels, pixels, level=9):
    colour = 2 if channels == 3 else 6
    stride = width * channels
    raw = bytearray()
    for y in range(height):
        line = pixels[y * stride:(y + 1) * stride]
        filtered = bytearray(stride)
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            filtered[i] = (line[i] - left) & 0xFF
        raw.append(1)  # Sub filter
        raw += filtered

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, colour, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), level))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


def to_rgba(width, height, channels, pixels):
    if channels == 4:
        return pixels
    out = bytearray(width * height * 4)
    for i in range(width * height):
        out[i * 4:i * 4 + 3] = pixels[i * 3:i * 3 + 3]
        out[i * 4 + 3] = 255
    return out

def flood_background(width, height, rgba, tolerance):
    """Make connected border-background pixels transparent, in place.

    Seeds are border pixels close to the most common border colour. BFS spreads
    to 4-neighbours within `tolerance`, which follows soft gradients (a drop
    shadow fading into the page) without jumping across the bee's dark outline.
    """
    def px(x, y):
        i = (y * width + x) * 4
        return rgba[i], rgba[i + 1], rgba[i + 2]

    border = []
    for x in range(width):
        border.append(px(x, 0))
        border.append(px(x, height - 1))
    for y in range(height):
        border.append(px(0, y))
        border.append(px(width - 1, y))
    counts = {}
    for c in border:
        counts[c] = counts.get(c, 0) + 1
    ref = max(counts, key=counts.get)

    def near(c):
        return (abs(c[0] - ref[0]) <= tolerance
                and abs(c[1] - ref[1]) <= tolerance
                and abs(c[2] - ref[2]) <= tolerance)

    seen = bytearray(width * height)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if not seen[y * width + x] and near(px(x, y)):
                seen[y * width + x] = 1
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if not seen[y * width + x] and near(px(x, y)):
                seen[y * width + x] = 1
                queue.append((x, y))

    cleared = 0
    while queue:
        x, y = queue.popleft()
        rgba[(y * width + x) * 4 + 3] = 0
        cleared += 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                if near(px(nx, ny)):
                    seen[ny * width + nx] = 1
                    queue.append((nx, ny))

    # Soften the rim: near-background pixels touching cleared area become
    # partially transparent, which avoids a hard 1px halo when scaled down.
    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if seen[idx] or not near(px(x, y)):
                continue
            touching = 0
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < width and 0 <= ny < height and seen[ny * width + nx]:
                    touching += 1
            if touching:
                rgba[idx * 4 + 3] = max(0, 255 - touching * 60)

    return cleared, ref


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    src, dest = Path(argv[1]), Path(argv[2])
    tolerance = 28
    if '--tolerance' in argv:
        tolerance = int(argv[argv.index('--tolerance') + 1])

    width, height, channels, pixels = read_png(src)
    rgba = to_rgba(width, height, channels, pixels)
    cleared, ref = flood_background(width, height, rgba, tolerance)
    write_png(dest, width, height, 4, rgba)

    print(f'{src.name} -> {dest.name}')
    print(f'  size      : {width}x{height} -> RGBA')
    print(f'  background: rgb{ref}, tolerance {tolerance}')
    print(f'  cleared   : {cleared:,} px ({cleared / (width * height) * 100:.1f}%)')
    print(f'  file      : {dest.stat().st_size / 1024:.0f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
