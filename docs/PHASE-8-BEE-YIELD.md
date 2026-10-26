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

---

# Phase 9 — Admin panel, referrals, and UI fixes

Everything below is verified: **152 tests passing** (up from 125), plus a live
end-to-end run that drives the admin API and then confirms gameplay sees the
result.

## 1. Admin panel (`/admin.html`)

The game had no admin surface at all — settings were edited by hand in the
Firebase console, which is how the live database drifted out of sync with the
code. Worse, drift is invisible: `Economy.config()` merges stored values over
the defaults, so a stale key still "works" and a typo'd key is ignored silently.

Added:

- `apps/api/lib/admin.js` — `AdminService` + `validateTasks`, with a settings
  schema (bounds on every number, so `rateTon: 0` cannot divide-by-zero the
  withdrawal quote) and cross-field checks (`yieldPerRunMax >= yieldPerRunMin`).
- `/api/admin/{config,tasks,grant,ban,withdrawals}`, guarded by `ADMIN_TOKEN`.
- `apps/web/public/admin.html` + `admin.js` — standalone page, no build step, so
  it keeps working even if the game bundle breaks.

Three things worth calling out:

- **The admin routes were initially placed *after* the `initData` gate**, so every
  admin call would also have needed a valid Telegram player session. They now run
  before it: the operator authenticates with a token, not as a player.
- **Token comparison is constant-time** (`crypto.timingSafeEqual`), with the
  length check written so it does not itself leak length.
- **`grantBalance` reads the balance back from the store.** The memory store's
  `increment` returns the updated *user*, while Firebase's returns the new field
  *value* — a number. Trusting either shape would have silently reset balances
  to zero in production.

`ADMIN_TOKEN` unset means the admin API is disabled and fails closed. The token
is held in `sessionStorage`, so it dies with the tab.

## 2. Referrals were dead code — now gated on membership

`registerReferral` existed and was tested, but **nothing ever called it**: the
`/api/invite` route returned early. No referee was recorded and no referrer ever
earned a share. It now registers from the signed `start_param` (exposed from the
verified `initData`, so it cannot be forged) and accepts both `<id>` and
`ref_<id>`.

A referral also no longer counts on the deep-link click alone. The original
credited unconditionally, so opening `?startapp=<id>` from an alt account minted
referral income without joining anything. Crediting now requires a real
`getChatMember` check; a non-member is recorded as `not_member` and *nothing is
written*, so the link can be retried after joining.

## 3. Real membership check

`isMember` was `async () => process.env.ALLOW_TASK_CLAIMS === '1'` — a flag that
returned `true` for everyone once enabled, making "join the channel" decorative.
It is now a real `getChatMember` call that treats `left`/`kicked` as not a member
and **fails closed** on any Telegram error.

## 4. Tasks

The list contained four legacy entries including two `@HappyCowFarm` channels
inherited from the template this game was built from. Only
`@HoneyBeeFarmChannel` remains; more can be added from the admin panel.

Tests that hard-coded `t1`/`t2` now derive the id from config, so the task list
can change without breaking them.

## 5. Audio: silent until the switch was toggled

`unlock()` was registered with `{ once: true }`. If that first tap landed before
the browser counted it as a valid gesture (easy during the loader fade), audio
stayed silent until the player toggled the setting off and on — exactly the
reported symptom. Unlock now retries on every interaction (it is idempotent), and
a blocked `play()` is logged rather than swallowed by an empty `catch`.

## 6. Layout overrides were doing nothing

`#mascot-pen` and `#tab-home` overrides had been written but never applied: the
Tailwind build injects its stylesheet into `<head>` **after** `layout-fixes.css`,
so an equal-specificity utility (`pb-32`, `-mt-16`, `w-[300px]`) won on cascade
order regardless of how many ids the selector carried. The overrides now use
`!important` — deliberately, and commented as such — and `pb-32`'s 128px of dead
space (the bottom nav already occupies that area) is reclaimed.

## 7. `layout.test.js` was locking in the sheep skin

The test compared the Farm tab against `reference/decompile/original.html`
class-for-class, which meant **the honey retheme could never pass** — it was
asserting that `game-btn-green` stay green. It now compares structure only,
stripping theme-colour utilities, so a dropped element still fails while a
recolour does not.

## 8. Smaller fixes

- Loading title is "Honey Bee Farm" (was "Lucky Bee Farm").
- Primary button is yellow and reads "Collect Honey" (was green "SHEAR").
- Wool-flying strands were white 24×12 crescents (`border: 3px solid #fff`) —
  unmistakable fleece mid-honey-collection. Overridden to amber droplets; the
  base stylesheet stays byte-identical.
- The mascot GIF was a 240×135 source squashed into 80×80, which letterboxed it
  and made it look small; now sized 150×84 with a rounded mask.
- Loader logo lost its 4px border and outer ring.
- Fallback markup said "Balance" where the i18n key said "Honey"; the hardcoded
  attribute is what shows before translations load.
- Language dropdown was still grass green.

## Still outstanding

- `AD_POSTBACK_SECRET` in Vercel does not match the `secret=` in the Monetag
  postback URL, so every real postback returns `bad_secret` and ad rewards never
  credit. This is a dashboard value, not a code change.
- No automated TON payout sender. `listWithdrawals` surfaces the queue for
  manual settlement only; an automated sender needs an idempotent, dry-runnable
  implementation and a review before it touches real funds.
