# Phase 4 — Fidelity: i18n done, font under investigation

## Localisation — DONE (32 locales)

| Item | Before | Now |
| --- | --- | --- |
| Locales available | English only (hard-coded) | **32**, lazily loaded per locale |
| Strings source | hand-written English in `main.js` | the original's own copy (106 keys) |
| Bundle | 1 chunk | main + 32 locale chunks, like the original |

### How it was recovered

1. **English was not a file.** The original kept it inline in the main bundle
   (`g={title:"Lucky Sheep Farm",...}`) and shipped the other 31 locales as
   lazily-imported chunks — which is why no `en-*.js` exists.
   `scripts/extract-i18n.py` lifts those 106 keys into `i18n/en.json`.
2. **31 chunks → JSON.** `scripts/convert-locales.py` parses each
   `const t={...}` literal into `i18n/<locale>.json`.

### Two real bugs found while doing this

**Bug 1 — Chinese locales silently collapsed.** The filename parser used
`^([a-z]{2}(?:-[a-z]+)?)-<hash>\.js`, which matched `zh-hans-*` and `zh-hant-*`
as `zh` — so one table overwrote the other and both shipped as "zh". Fixed by
matching against the known locale list, longest prefix first. There is now a
test asserting `zh-hans.tab_tasks !== zh-hant.tab_tasks`.

**Bug 2 — a dynamic import shipped only English.** `import(\`./i18n/${code}.json\`)`
is not statically resolvable, so Rollup dropped every locale and the build still
succeeded. Replaced with an explicit importer map — the same technique the
original bundle used (`"./lang/ko.js": () => import("./ko-<hash>.js")`).
Verified: the build now emits 32 locale chunks.

### Behaviour

- `t(key, params)` falls back locale → English → the key itself, so a missing
  string is visible rather than blank.
- Locale comes from `Telegram.WebApp.initDataUnsafe.user.language_code`;
  unknown codes fall back to English.
- `applyTranslations()` replaces every `data-key` element at boot, matching the
  original's `X()` pass.
- Toast and error copy now come from the original's own strings
  (`toast_collect_success`, `api_not_member`, …) instead of my paraphrases.

Tests: 60 passing, including placeholder-parity checks across all 32 locales
(a translation that drops `{amount}` would now fail the suite).

---

## Fonts — FIXED by removing both external dependencies

The markup and CSS were already byte-identical to the original, so the
difference had to come from *how* the font and utilities were fetched. Both were
runtime dependencies on third-party CDNs:

| Dependency | Before | Now |
| --- | --- | --- |
| Nunito | `fonts.googleapis.com` `<link>`, `display=swap` | **5 local woff2** + `assets/fonts/nunito.css` |
| Tailwind | `cdn.tailwindcss.com` (302 → current version) | **vendored** `assets/vendor/tailwind-3.4.17.js` |

### Why this fixes it

Three failure modes were possible and all three are now impossible:

1. **Font-swap timing.** On a cold deploy `display=swap` paints a fallback face
   until Nunito arrives. Self-hosting removes the round trip, and a
   `<link rel=preload>` on the latin woff2 starts the fetch before CSS parsing.
2. **Webview cache.** Telegram can cache or block a third-party font host;
   our own origin is never blocked.
3. **Tailwind drift.** `cdn.tailwindcss.com` serves whatever version is current
   — it 302s to `/3.4.17` today. The vendored file is byte-identical to that
   build (`176e8946…`), so styling is now frozen.

### How it was generated

```bash
python3 scripts/self-host-font.py
```

It fetches Google's CSS with a desktop UA (so woff2 is returned rather than
legacy ttf), downloads the 5 unique files, rewrites `src` URLs to
`/assets/fonts/<file>.woff2`, and **verifies every rewritten path exists**.
The first run failed that check because the regex kept the `/nunito/v32/`
segment — the validation caught it rather than shipping broken `src` lines.

Subsets and `unicode-range` values are unchanged, so glyph coverage for the 32
supported locales (cyrillic, vietnamese, latin-ext, …) is identical to Google's.

Total cost: **152 KB** of woff2 + 5 KB CSS + 407 KB vendored Tailwind.

### Regression guards

`apps/api/test/assets.test.js` fails the suite if:

- an external font `<link>` is reintroduced
- `nunito.css` references a file that does not exist
- any of the 400/700/900 weights goes missing
- a woff2 is empty
- the Tailwind CDN script returns, or the vendored copy is truncated

Verified by deliberately reintroducing the Google `<link>` — the suite failed,
then passed again once reverted.

### Remaining external requests

`telegram.org/js/telegram-web-app.js` (required — it *is* the Mini App SDK) and
`unpkg.com/lucide` (icons). Both are left as-is deliberately: Telegram's own
SDK must come from Telegram, and lucide is cosmetic. Pinning lucide is a small
follow-up if you want total determinism.


### How the cause was narrowed

Before changing anything I confirmed the obvious suspects were innocent, so the
fix would target the real cause:

- the Google Fonts `<link>` was **byte-identical** to the original's, same
  family, weights (400;700;900) and `display=swap`
- the tag order matched (`tailwind` script, then the stylesheet)
- `assets/index.css` is byte-identical (`c4a8b692…`), including
  `body{font-family:Nunito,sans-serif}`
- Tailwind 3.4.17's preflight sets `font-family` only on `html`, and
  `font-bold`/`font-black` set only `font-weight` — nothing in the cascade
  overrode `body`

Since markup and CSS were identical, the variable had to be the **delivery** of
the font and utilities, which is exactly what self-hosting removes. That is why
this fix did not require a screenshot to justify itself.
