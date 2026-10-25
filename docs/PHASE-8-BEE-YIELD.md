# Bee reskin + randomised yield

## 1. Randomised shift yield

The original paid the **same number every shift** (182,351). A constant reads as
machine-made, so the payout is now rolled per shift on the **server**:

```
woolPerShiftMin: 165_000
woolPerShiftMax: 198_000
```

Measured over 500 shifts: **252 distinct values**, range 165,100–197,900,
average **181,418** — so the economy level is unchanged while the number moves.

Details that matter:

- **Server-side only.** `harvest()` takes no amount argument, so the client
  cannot influence it. A test asserts a client-supplied `wool` is ignored.
- **Rounded to the nearest 100**, because `182,337` looks generated while
  `182,300` looks like real output.
- **`min === max` is a valid fixed range**, not a missing one. My first
  implementation treated `max <= min` as "no range" and silently fell back to
  the legacy constant — a test caught it.
- **The range can never round below its floor.** Small ranges such as `10–10`
  would otherwise round to 0.
- A legacy `woolPerShift` still works when the range is genuinely unusable
  (`max < min`).

Admins tune it in `system_config` with no redeploy; the seed fixture and
`DEFAULT_CONFIG` were both updated and are asserted to agree.

## 2. Bee skin assets

Uploaded art in `beeskin/`:

| File | Original | Display size used |
| --- | --- | --- |
| `1792885136481.png` | 1408×3008, 5.1 MB | `background.png` 750×1602, **1.67 MB** |
| `1792886127392.png` | 2048×2048, 1.8 MB | `sheep.png` 512×512, **156 KB** |

Combined: **7.2 MB → 1.8 MB**. The uploads were print-sized; that would have
been a slow first paint on mobile data.

`scripts/optimize-beeskin.py` does the conversion. No image libraries exist on
this host (no PIL, no ImageMagick), so it is a small pure-Python PNG resizer:
standard filters in, area-average downscale, Sub-filtered output. Narrow on
purpose rather than a general PNG implementation.

Verified: correct magic bytes, dimensions, chunk list and **CRC per chunk**;
and the 512×512 sprite renders correctly.

### One thing to know about the sprite

The uploaded PNGs are **RGB with no alpha**, so the bee carries an opaque white
box behind it. Against the busy farm background that will show as a white
square. The previous `sheep.png` had the same limitation, so this is not a
regression — but a transparent-alpha export would look noticeably better.

## 3. Videos → GIF

Both MP4s are **1280×720, 10 s**, H.264 in an `isom` container. The original
`scissors.gif` is 180×180 and 88 KB, so convert at roughly **240×240** to keep
the button area light. No `ffmpeg` on this host, so this step is yours:

```bash
ffmpeg -i beeskin/gemini_generated_video_75916ce8.mp4 \
       -vf "scale=240:-1:flags=lanczos,fps=15" \
       -loop 0 apps/web/public/scissors.gif
```

Until then `scissors.gif` remains the sheep-era scissors, which is the only
sheep artwork left in the UI.

## Tests

120 passing (8 new for the yield), stable across three consecutive runs. Tests
that previously asserted the fixed 182,351 now assert the range, the multiple of
100, and the variance.
