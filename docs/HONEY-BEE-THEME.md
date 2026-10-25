# Honey Bee Farm — full theme pass

## 1. Theme-neutral identifiers

The code inherited the original's vocabulary. Renaming it makes a future reskin a
**content** change rather than a code change, which was the goal.

| Before | After | Why |
| --- | --- | --- |
| `wool` | `balance` | the currency itself is theme-specific |
| `pendingWool` | `pendingYield` | earned, not yet collected |
| `refEarnedWool` | `refEarned` | |
| `woolPerShift` / `Min` / `Max` | `yieldPerRun*` | "shift" was sheep-era too |
| `shiftDurationMs` | `runDurationMs` | |
| `workEndTime` | `runEndTime` | |
| `withdrawalMinWool` | `withdrawalMin` | |
| `insufficient_wool` | `insufficient_balance` | |
| `withdraw_wool_amount` | `withdraw_amount` | |
| `task_reward_wool` | `task_reward` | |
| `sheep-pen` / `sheep-img` | `mascot-pen` / `mascot-img` | |
| `wool.png` | `currency.png` | |
| `val-wool` / `val-pendingWool` / `val-refEarnedWool` | `val-balance` / `val-pendingYield` / `val-refEarned` | |

Applied by `scripts/rename-theme-ids.py`: **431 replacements across 49 files**,
including the API contract, so client and server moved together.

### Two bugs the rename introduced, and the tests that caught them

**The CSS drifted from the markup.** `#sheep-pen` became `#mascot-pen` in the
HTML but the selector in `layout-fixes.css` was not renamed, so the pen silently
lost its 240px sizing. Caught by the layout test.

**A test became unfalsifiable.** A test asserting *what the original contained*
had its expected string rewritten from `wool-particle` to `balance-particle` —
so it would pass no matter what. Restored to assert the original's real value,
with a comment explaining why that literal must not be renamed.

The wool-particle **CSS class** was deliberately left alone: it lives in the
byte-identical original stylesheet, so renaming it in JS only would break the
animation. Only our own identifiers changed.

## 2. Assets

| File | Status |
| --- | --- |
| `mascot.png` | bee sprite, **background removed** (flood fill from the border, so enclosed white in the eyes and wings survives) |
| `currency.png` | **new** honey-drop icon, generated procedurally (64×64 RGBA, 1.5 KB) |
| `logo.png` | bee badge (JPEG), 115 KB vs 604 KB |
| `music.mp3` | **your track** installed (1.2 MB) |
| `scissors.gif` | your bee animation (240×135, 150 frames) |

## 3. Audio — it was never wired

The settings toggle flipped `audioEnabled` and saved it to the server, but
**nothing played**. The game was silent even with the switch on.

`apps/web/src/audio.js` now provides:

- looping background music at 0.45 volume (below the effects, as the original did)
- click / claim / modal / reward effects at the original four moments
- `unlock()` on the first `pointerdown`, because browsers block autoplay until
  the player interacts — the original used the same once-only listener
- the toggle now actually pauses and resumes playback

## 4. Loading screen

The logo is a **JPEG**: a circular badge inside an 800×800 white square, so it
cannot carry transparency. In the original's rounded-square container with a
yellow gradient behind it, those white corners showed as hard edges.

Fixed by **circular-cropping in CSS** (`border-radius: 50%` + `overflow: hidden`
+ a 1.06 scale to trim the white band), rather than trying to remove corners
from a JPEG with no decoder available. The badge is already round, so the mask
cuts exactly the white and nothing else.

The loader itself: honey-gradient bar with a slow shimmer, floating logo, warmer
track, and a `prefers-reduced-motion` fallback.

## 5. Palette

The browns and creams already suited a hive. The **greens** were the sheep-farm
leftover (`#97BA42` grass, `#9DFB6E` fresh grass):

| Before | After | Use |
| --- | --- | --- |
| `#97BA42` | `#C97D00` amber | labels, active nav, toggle |
| `#9DFB6E` | `#FFD659` honey | success toasts, retry button |

`#C97D00` was chosen over a lighter amber because it stays legible on the cream
cards; `#FFD659` matches the currency icon.

## 6. Config

`system_config` was synced and **pruned**:

```
pruned 4 stale key(s): shiftDurationMs, woolPerShift, woolPerShiftMax, woolPerShiftMin
live: 9 keys
```

`sync-config.js --prune` removes keys the fixture no longer declares, so the
database cannot drift into describing a schema the server does not read.

## 7. Bot

Referral default is now `honeybeefarmbot`; override with `VITE_BOT_USERNAME`.

> **The bot token shared in chat should be revoked.** Anyone holding it can send
> messages as the bot and read its updates. @BotFather → /mybots → API Token →
> Revoke. Set the replacement only in Vercel's environment variables.

## Tests

125 passing, including:
- the Farm tab keeps the same tags and classes as the original
- the CSS pen selector matches the markup id
- the effect classes still match the stylesheet
