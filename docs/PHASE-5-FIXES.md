# Phase 5 — Fixes from live testing

Reported symptoms: loading stuck at `0%` showing the raw
`loading game %{progress_game}`, no music toggle, and shearing/buttons doing
nothing.

## 1. Buttons dead — the real cause (production 500)

```
GET https://beefarm-lake.vercel.app/api/health  ->  500 FUNCTION_INVOCATION_FAILED
```

Every `/api` route was crashing, so `SHEAR` called a dead endpoint. The client
did surface the error, but nothing could ever succeed.

**Root cause:** a function declared at root `api/` gets its dependencies
installed from a **root `package.json`**. There wasn't one — `apps/api/package.json`
lists `firebase-admin`, but `apps/api/node_modules` is gitignored, so Vercel
deployed the function with no `firebase-admin`.

Reproduced locally by deleting `apps/api/node_modules`:

```
FAIL: firebase-admin not available (ERR_MODULE_NOT_FOUND)
```

**Fix:** added a root `package.json` with `firebase-admin`, and
`api/index.js` keeps re-exporting the shared handler.

**Second bug found while verifying:** with no service account, the handler
retried OAuth indefinitely and surfaced as a 500 timeout. It now fails fast
with an actionable `reason`, so a misconfiguration reads as:

```json
{"success":false,"errorCode":"system_error",
 "reason":"[vercel] FIREBASE_SERVICE_ACCOUNT is not set. ..."}
```

instead of a blank error page.

## 2. Loader stuck at 0% with `{progress_game}`

Two independent defects:

- **No animation existed.** `hideLoader()` only hid the loader; nothing ever
  advanced the bar. Added `startLoader()` / `finishLoader()` mirroring the
  original: ramp towards 90% (`+rnd(10)+2` every 120ms), jump to 100% once the
  player record arrives.
- **The placeholder was printed raw.** `applyTranslations()` wrote
  `t('preparing')` without params, producing the literal
  `Preparing farm... {progress}%`. The loader now passes
  `{ progress: n }`, and `applyTranslations()` skips any key containing `{`.

`%{progress_game}` specifically is **Telegram's own** overlay string, not ours.
It stayed on screen because `telegram.ready()` was called during init — before
our loader had finished — so Telegram's spinner never learned the app was ready.
`ready()` now runs via `markReady()` **after** the first screen renders.

## 3. Music

Not implemented, and per your call it stays out of this version. The settings
modal still renders the audio toggle; it currently flips a state flag with no
audio attached. The original assets (`music.mp3`, `click/claim/modal/reward.mp3`)
are already in `public/`, so wiring it later is a `new Audio()` plus the
existing `toggle-audio-btn` handler.

## 4. Ads

No provider is configured, so `AD_POSTBACK_SECRET` is unset and the server
**does not gate shifts** — shearing works without an ad. If you later set the
secret, the client requests the ad, and with no SDK present it shows
`toast_no_ads` and declines, exactly as the original did.

This is why "buttons do nothing" was not an ad problem: the ad path was never
reached.

## 5. Referrals

Still pointed at the original bot username. `VITE_BOT_USERNAME` overrides it at
build time; the reward maths and idempotency are already implemented and tested
(see `REFERRALS.md`). Deferred as agreed.

---

## Tests

71 passing, including 5 new guards:

| Test | Prevents |
| --- | --- |
| root `package.json` declares `firebase-admin` | the production 500 returning |
| `api/index.js` re-exports the handler | entrypoint drift |
| re-export target exists | broken build |
| loader animates and substitutes `{progress}` | stuck 0% / raw placeholder |
| `ready()` is not called during init | Telegram overlay never dismissing |
