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

## Fonts — NOT resolved, and I will not guess

The loading chain is **byte-identical to the original**:

- same `<link>` to `fonts.googleapis.com/css2?family=Nunito:wght@400;700;900`
- same preconnects
- same tag order (`tailwind CDN` at line 13, stylesheet at line 18)
- `assets/index.css` is byte-identical (`c4a8b692…`), including
  `body{font-family:Nunito,sans-serif}`

I also verified Tailwind 3.4.17's preflight only sets `font-family` on `html`,
and its `font-bold`/`font-black` utilities set only `font-weight` — so nothing in
the cascade should override `body`.

**Conclusion: the difference is not in markup or CSS.** The remaining
possibilities, in order of likelihood:

1. **Font loading timing (FOUT).** `display=swap` renders a fallback face until
   Nunito arrives. On a cold Vercel deploy with a fresh CDN cache this is
   visible; the original is warm. Transient, not a code defect.
2. **The Telegram webview cache** holds an older/blocked copy of the font.
3. **Tailwind CDN drift.** `cdn.tailwindcss.com` currently 302s to `/3.4.17`.
   Both the original and the rebuild point at the *unpinned* URL, so both drift
   together — but a version change could shift metrics for one and not the
   other if one side was cached.

### What would settle it

A side-by-side screenshot of the same screen from both apps, ideally with the
network panel showing whether `fonts.gstatic.com` returned 200 or fell back.
Without that I would only be guessing at which of the three it is.

### The fix I can do blind (Phase 6, listed in the plan)

- Self-host Nunito (400/700/900, woff2) from `/assets/fonts/`, with a local
  `@font-face` block and `font-display: swap`.
- Pin Tailwind to a fixed version and vendor it.

That removes both external dependencies, makes rendering deterministic, and
eliminates possibilities 1–3 above regardless of which it is.
