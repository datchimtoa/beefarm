# Phase 7 — Two bugs from real-device testing

## 1. The SHEAR button disappeared after harvesting

**Symptom:** harvest once, the button vanishes; reloading does not bring it back.

**Cause:** a mistake of mine from Phase 6. The button lives *inside*
`#normal-action-cards`:

```html
<div id="action-area">
  <div id="normal-action-cards" class="w-full">
    <button id="btn-main-action">…</button>
```

I had added `classList.add('hidden')` to that container in the idle phase,
thinking the original hid its action cards there. It does not — it only ever
*removes* `hidden`:

```js
else if (s && s.classList.remove("hidden"), e >= O.workEndTime) …
```

So after harvesting, the UI returned to idle, hid the container, and took the
button with it. Because the idle state also stops re-fetching, nothing could
restore it — including a reload, which re-rendered straight back into the same
hidden state.

**Fix:** no phase hides the container any more; all three reveal it. A test now
fails if anything ever adds `hidden` to `#normal-action-cards` again, and I
verified it fails by reintroducing the bug.

## 2. The button required scrolling

**This is a deliberate deviation, not a defect.** The Farm tab is identical to
the original, and the original genuinely requires scrolling — confirmed both by
the markup and by your own screenshot of it.

The space was being wasted rather than used:

| Source | Cost |
| --- | --- |
| `pb-32` on the tab | 128px |
| `pt-6` | 24px |
| `5 × space-y-6` | 96px |
| `p-4` | 32px |
| **total padding/gaps** | **280px** |

...competing with a 300px sheep for roughly 714px of usable height.

### How it is fixed

A separate `layout-fixes.css`, loaded **after** `index.css`, so:

- the original stylesheet stays byte-identical
- the deviation is in one small, auditable file
- reverting it is deleting one `<link>`

Changes: bottom padding reclaimed (the tab's `pb-32` was double-reserving space
the bottom nav already occupies), the 300px pen shrunk to 240px, the
absolute-positioned scissors rescaled with it so it stays centred, and the yield
card tightened slightly.

The Farm tab **markup** is untouched — a test asserts it is still byte-identical
to the original, so layout work can never quietly alter the structure.

## Notes

- The reskin will replace the PNGs only (`background.png`, `sheep.png`,
  `logo.png`, `wool.png`, `scissors.gif`); the layout is now independent of
  their pixel dimensions because the pen is sized in CSS.
- 112 tests passing (5 new).
