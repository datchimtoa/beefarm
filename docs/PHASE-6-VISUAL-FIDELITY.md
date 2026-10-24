# Phase 6 — Closing the visual gap

The self-assessment was ~85%, and the missing 15% was concentrated in ten DOM
elements the original drove and we did not. All ten are now wired.

## What was missing, and what it did

| Element | Original behaviour | Now |
| --- | --- | --- |
| `wool-particles` | floating `+N 🐑` on harvest | ✅ |
| `crescent-strand` (inside wool-particles) | wool strands flung out while shearing | ✅ |
| `scissors-img` | animated GIF, visible only while working | ✅ |
| `normal-action-cards` | timer/action cards, hidden until a shift exists | ✅ |
| `truck-timer-box` | payout countdown box, only while a withdrawal is pending | ✅ |
| `no-internet-modal` | offline dialog | ✅ |
| `internet-title` / `internet-desc` | its heading and body | ✅ |
| `internet-icon-container` | icon state (error vs close) | ✅ |
| `btn-retry-internet` | retry / close action | ✅ |
| `action-area` | `pointerEvents: none` while disconnected | ✅ |

## The two that mattered most

These are the difference between "looks static" and "feels alive", so they were
reproduced from the original's actual parameters rather than approximated:

**Harvest reward** — `wool-particle` class, `floatUp` 1.5s, `+182,351` plus the
`wool.png` icon, removed after 1500ms.

**Shear strands** — a `crescent-strand` div every ~90ms, 1–3 per tick, positioned
at `left: 47–65%`, `top: 25–35%`, flung `40–180px` on a random angle with
`--rot` between −360° and +360°, animated by `flyOutStrand` for 0.9s.

Both keyframes and both CSS classes were already in the byte-identical
stylesheet, so only the spawn logic had to be written.

## Verified

The effects module was exercised against a minimal DOM:

```
wool reward element: true | text: +182,351<img src="/wool.
strands spawned in 3 ticks: 6          (1-3 per tick, as the original)
strand has --tx/--ty/--rot: true
```

## Fidelity now

| Dimension | Before | After |
| --- | --- | --- |
| DOM elements driven | 37/47 (79%) | **47/47 (100%)** |
| Client + server logic | 100% | 100% |
| Assets / CSS | 100% | 100% |
| i18n strings | 100% of keys | 100% |
| Tests | 100 | **107** |

The remaining differences are architectural rather than visual, and deliberate:

- no Firebase SDK in the browser (state comes from our API instead)
- the 70-hour `U()` bug is fixed rather than reproduced
- offline detection uses the browser's events, not Firebase `.info/connected`
