# Rebuild plan — "Lucky Sheep Farm" faithful recreation

Goal: reproduce the original game as closely as possible, then reskin to bees
(honey) in a later, separate effort. Phases 1–6 stay **faithful**; the reskin is
deliberately postponed so we always have a byte-comparable baseline.

Reference ground truth: `reference/MANIFEST.md`. Never edit `reference/`.

---

## What we actually have

| Layer | Coverage | Notes |
| --- | --- | --- |
| `index.html` | 100% | served verbatim; 132 elements, 57 IDs, 48 of which the JS touches |
| `index.css` | 100% | 5 KB, no `@tailwind` directives |
| Images + audio | 100% | 5 images (bg, scissors GIF, logo, sheep, wool) + 5 MP3s |
| Client JS | ~100% semantics | AST-verified: 176/176 functions, 811/811 strings |
| i18n | 100% | 106 keys × 32 locale chunks downloaded |
| Tailwind utilities | 100% list | 727 class instances, 114 distinct utilities, 9 arbitrary hex |
| **Visual reference** | 4 real-device shots | 1080×2400, all four tabs — `reference/evidence/game-screens/` |
| `/api` server | 0% | 404 in production — **must be authored** |
| Ad SDK | 0% | `show_11373165` third-party — **must be authored** |

### Layout caveat discovered from the real screenshots

On a 1080×2400 device the **Farm tab is taller than the viewport**: the
`READY!` state shows the sheep and the status, and the **HARVEST button sits
below the fold** — you must scroll up to reach it. The tab content scrolls
inside `#app-content`, which is `h-[100dvh]`. Any fidelity check that only
captures the first screen will wrongly conclude the button is missing.


---

## Phase 0 — Reference lock (DONE)

- [x] Capture bundle, HTML, CSS, 5 images, 5 audio, 32 locales
- [x] AST decompile + integrity check
- [x] `reference/MANIFEST.md`
- [x] Map JS↔HTML ID contract (48 IDs)

---

## Phase 1 — Static shell (zero JS)

Ship the page as it appears before any logic runs.

- Copy `original.html` → `public/index.html`
- Copy `original.css` → `public/assets/index.css`, rewrite the `<link>`
- Copy the 5 images + 5 audio to `public/`
- Keep `cdn.tailwindcss.com` **for now** (Phase 6 vendors it)
- Remove the `<script type="module">` line so the page is inert

**Verify:** page renders identically; loader bar visible; no console errors.
Diff `public/index.html` vs `original.html` — only the `<link>` may differ.

**Risk:** none material. This phase is a file copy plus one tag removal.

---

## Phase 2 — Client logic, verbatim behaviour

Wire the real bundle against a local mock, no server needed yet.

- Serve `original.min.js` unmodified from `public/assets/`
- Point `databaseURL` at a local Firebase RTDB emulator (or a stub `onValue`)
- Stub `window.show_11373165` to resolve after 500 ms
- Stub `fetch("/api/...")` in a small `mock-api.js` returning the shapes the
  client expects (`{success:true}` / `{success:false,errorCode:"..."}`)

**Verify:** the full loop is playable end-to-end — SHEAR → ad stub → 3-min
countdown → HARVEST → wool increments → task claim → withdraw form unlocks.

**Why this matters:** it proves our *understanding* of the client before we
rewrite a single line. If something misbehaves here, my decompile was wrong.

---

## Phase 3 — Authored client (readable source)

Rewrite the bundle as maintainable ES modules with identical behaviour.

| Module | Owns |
| --- | --- |
| `state.js` | the `O` object + `V()` reducer, defaults, `q()` number format |
| `firebase.js` | `users/<id>` listener, `system_config` listener, `.info/connected` |
| `actions.js` | `harvest`, `claimTask`, `invite`, `withdraw` + error-code mapping |
| `render.js` | `ee()`/`ie()`/`le()`/`J()` — DOM sync |
| `clock.js` | `U()`, `G()`, `Y()`, `K()` — the UTC+7 payout window |
| `i18n.js` | `k()` + dynamic locale import |
| `audio.js` | the `S` sound manager |
| `ui.js` | tabs, dropdowns, modals, toasts, particles |
| `boot.js` | the 120 ms fake loader, Telegram guard, fetch 401 wrapper |

**Verify:** replay Phase 2's script; every screen must match. Then
element-by-element DOM diff against the original at each of the 4 tabs.

---

## Phase 4 — Server (`/api`)

The only part with no reference. Contract is fully known from the client:

| Endpoint | Method | Body | Error codes the client maps |
| --- | --- | --- | --- |
| `/api/harvest` | POST | none | `not_ready`, `unauthorized`, `banned`, `system_error` |
| `/api/claim_task` | POST | `{taskId}` | `not_member`, `already_claimed`, `unauthorized` |
| `/api/invite` | POST | none | `failed_invite`, `unauthorized` |
| `/api/withdraw` | POST | `{wallet, amount}` | `invalid_wallet`, `invalid_amount`, `insufficient_wool`, `min_withdraw_error`, `not_ready` |

Shared behaviour: `x-init-data` → Telegram HMAC verify → resolve `userId`;
401 means "auth failed" (client freezes by design); all responses
`{success:boolean, errorCode?:string, ...}`.

**Server must own:** shift start/end (`workEndTime`), wool credited,
`min_withdraw`, `rate_ton`, the once-per-day withdraw lock, and the payout flag.

---

## Phase 5 — Ad integration

Replace the stub with a real provider while keeping the original contract:

```js
show_<zone>({ ymid: String(telegramId), requestVar: "start-shift" })
  .then(() => setTimeout(done, 500))
```

**Must keep:** the existence gate (no ads → "try later"), the
`ymid = telegramId` binding (postback keyed to the same id), and the 500 ms
settle delay — otherwise reward timing diverges from the original.

---

## Phase 6 — Fidelity hardening

- [ ] Vendor a pinned Tailwind build instead of `cdn.tailwindcss.com`
- [ ] Self-host the Nunito font
- [ ] Screenshot diff original vs rebuild at 390×844 and 412×915
- [ ] Confirm all 32 locale chunks load and switch correctly
- [ ] Verify GIF animation timing and particle spawn cadence

---

## Phase 7 — Reskin to bees/honey (separate, later)

Deferred on purpose. Requires a decision first:

- **Rename schema** `wool` → `honey`, `pendingWool` → `pendingHoney`, etc.
  (clean, but a data migration and breaks diff-ability with the reference)
- **Keep schema**, change display strings only (fast, uglier)

Also needed: bee art, honey currency icon, a honeycomb-flavoured GIF to replace
`scissors.gif`, and new BGM/SFX.

---

## Fidelity scoreboard

| Item | Status |
| --- | --- |
| HTML / CSS / images / audio / locales | **100%** — downloaded verbatim |
| Client logic | **~99%** — AST-verified; 3 inert `;` differ |
| Pixel output | **unmeasured** — no browser on this host; needs your screenshot |
| Server behaviour | **0% by definition** — not in the client |
| Ad SDK internals | **0% by definition** — third party |

**Ranked unknowns, highest risk first:**

1. **Ad SDK semantics** — postback timing and fraud rules are invisible.
2. **Server economy** — unknowable; we author it (you own the parameters).
3. **Pixel parity** — needs one real browser comparison.
4. **Tailwind CDN drift** — real but trivially fixed in Phase 6.

---

## Immediate next action

Phase 1: a file copy plus removing one `<script>` tag, giving a static page we
can compare against the live site right away.

