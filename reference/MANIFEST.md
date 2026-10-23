# Reference bundle — LuckySheepFarm (original)

Captured 2026-10-21 from `https://luckysheepfarm.vercel.app` (Vercel deployment,
`x-vercel-cache: HIT`). This is the read-only ground truth for the rebuild.
**Do not edit files in this directory.**

## Layout

| Path | What it is | Integrity |
| --- | --- | --- |
| `decompile/original.min.js` | Production bundle as served, untouched | `58dd4752e0d78368f81d65cefd7001b59fd66932cf0def1a94eaec038b4258bd` |
| `decompile/original.html` | `index.html` as served (not Vite-generated; `public/`) | `6c40a7c3357723643b7bc2e569bda16704062b23db27b266902a5f9930ca7d61` |
| `decompile/original.css` | `assets/index-C33Y3w7k.css` | `c4a8b69223fa7c7399d191cc42cfc93350ef00a8991d57a3212478a89f8fd594` |
| `decompile/original.reprinted.js` | AST re-print of the bundle (readable) | see "Decompile method" |
| `decompile/deobf.py` | AST scanner: call sites, Firebase paths, i18n keys | — |
| `decompile/deobf_printer.py` | AST printer that produced `original.reprinted.js` | — |
| `original-site/assets/` | The 5 runtime images + 5 audio files | byte-identical downloads |
| `original-site/assets-index/` | 32 locale chunks (`ar-*.js` … `zh-hant-*.js`) | byte-identical downloads |
| `evidence/deobf_report.txt` | 649 call sites, path literals | — |

## Decompile method

`node` is unavailable on this host (`pkg install` fails: `dpkg: error: requested
operation requires superuser privilege`), so `terser`/`astring` were not usable.
Instead the bundle was parsed with **esprima 4.0.1** in a venv (`/tmp/jsenv`):

- `esprima.parseModule(...)` → **7,945 AST nodes, 0 parse errors**
- Re-printed from the AST, then re-parsed: valid
- **176/176 functions preserved**, **811/811 string literals byte-identical**
- Known delta: 3 inert extra `;` statements

To rebuild the venv:

```bash
python3 -m venv /tmp/jsenv
/tmp/jsenv/bin/pip install --no-build-isolation esprima==4.0.1   # or from the sdist
/tmp/jsenv/bin/python reference/decompile/deobf_printer.py <file.js>
```

## Runtime assets

| File | Type | Dimensions | Bytes | Role |
| --- | --- | --- | --- | --- |
| `background.png` | PNG | 750×1624 | 91,012 | Full-screen game background (`url('/background.png')`, inline style on `#app-content`) |
| `scissors.gif` | GIF | 180×180 | 88,508 | Animated shearing indicator during a shift |
| `logo.png` | PNG | 500×500 | 604,186 | Loading screen logo |
| `sheep.png` | PNG | 482×482 | 9,057 | Farm mascot |
| `wool.png` | PNG | 32×34 | 1,171 | Currency icon + floating `+N` particles |
| `music.mp3` | MP3 | — | 321,244 | Looping BGM |
| `click/claim/modal/reward.mp3` | MP3 | — | 13–59 KB | SFX |

## Firebase / live config (read-only observation)

`/system_config` is world-readable:

```json
{"last_payout_time":1792569628704,"min_withdraw":4500000,"rate_ton":450000000}
```

- `/users/<telegramId>` is world-readable, writes are denied
- the deployment's `/api/*` returns **404**, so server behaviour is unknowable

## Rules

1. Never modify this tree; copy from it instead.
2. Any deviation in the rebuild must be recorded in `REBUILD-LOG.md`.
3. The retuned/new code lives outside `reference/`.
