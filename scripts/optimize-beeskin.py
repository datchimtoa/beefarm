#!/usr/bin/env python3
"""Downscale the bee skin PNGs so the Mini App stays fast on mobile data.

The uploaded art is print-sized (1408x3008 background, 2048x2048 sprite) and
7.2 MB combined, against 100 KB for the sheep assets it replaces. On a phone in
Telegram that is a slow first paint, so the files are rewritten at display size.

No image libraries are available here (no PIL, no ImageMagick), so this is a
minimal pure-Python PNG resizer: it handles 8-bit RGB/RGBA truecolour with the
standard filters, which is what these files are. It is deliberately narrow
rather than a general PNG implementation.
"""
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'beeskin'


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
    width, height, depth, colour, _comp, _filt, interlace = ihdr
    if depth != 8 or colour not in (2, 6) or interlace != 0:
        raise ValueError(f'{path}: unsupported PNG (depth={depth} colour={colour} interlace={interlace})')

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
        if ftype == 1:      # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                upleft = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(left, prev[i], upleft)) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def box_downscale(width, height, channels, pixels, target_w, target_h):
    """Area-average each destination pixel from its source block."""
    out = bytearray(target_w * target_h * channels)
    for dy in range(target_h):
        y0 = dy * height // target_h
        y1 = max(y0 + 1, (dy + 1) * height // target_h)
        for dx in range(target_w):
            x0 = dx * width // target_w
            x1 = max(x0 + 1, (dx + 1) * width // target_w)
            count = (y1 - y0) * (x1 - x0)
            for c in range(channels):
                total = 0
                for y in range(y0, y1):
                    base = y * width * channels + c
                    for x in range(x0, x1):
                        total += pixels[base + x * channels]
                out[(dy * target_w + dx) * channels + c] = total // count
    return out


def write_png(path, width, height, channels, pixels, level=9):
    colour = 2 if channels == 3 else 6
    raw = bytearray()
    stride = width * channels
    # Filter type 1 (Sub) on every row: for photographic/gradient art like the
    # bee background it compresses far better than the unfiltered stream.
    prev = bytearray(stride)
    for y in range(height):
        line = pixels[y * stride:(y + 1) * stride]
        filtered = bytearray(stride)
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            filtered[i] = (line[i] - left) & 0xFF
        raw.append(1)
        raw += filtered
        prev = filtered

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, colour, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), level))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


def convert(src, dest, target_w, target_h):
    w, h, ch, px = read_png(src)
    before = src.stat().st_size
    out = box_downscale(w, h, ch, px, target_w, target_h)
    write_png(dest, target_w, target_h, ch, out)
    after = dest.stat().st_size
    print(f'{src.name:24s} {w}x{h} {before/1024/1024:.1f}MB -> '
          f'{dest.name:16s} {target_w}x{target_h} {after/1024:.0f}KB '
          f'({before/after:.0f}x smaller)')


def main():
    SRC.joinpath('out').mkdir(exist_ok=True)
    convert(SRC / '1792885136481.png', SRC / 'out' / 'background.png', 750, 1602)
    convert(SRC / '1792886127392.png', SRC / 'out' / 'sheep.png', 512, 512)
    return 0


if __name__ == '__main__':
    sys.exit(main())
