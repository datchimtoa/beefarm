#!/usr/bin/env python3
"""Rename the sheep-era identifiers to theme-neutral ones.

The rebuild inherited the original game's vocabulary: the currency is called
`wool`, the timer `workEndTime`, the mascot `sheep`, and the storage path
`sheep-pen`. None of that survives a reskin, and hand-editing it across the
client, the server, the tests and 32 locale files is exactly the sort of change
that leaves stragglers behind.

Naming choices, so the code stays theme-agnostic:

  wool            -> balance        (the player's spendable amount)
  pendingWool     -> pendingYield   (earned but not yet collected)
  refEarnedWool   -> refEarned      (referral commission)
  woolPerShift*   -> yieldPerRun*   ("shift" was also sheep-era: a work shift)
  shiftDurationMs -> runDurationMs
  workEndTime     -> runEndTime
  *Wool* (keys)   -> *Yield* / *Balance* as appropriate
  withdrawalMinWool -> withdrawalMin
  sheep-pen       -> mascot-pen
  sheep-img       -> mascot-img
  wool.png        -> currency.png

The API field names change too, so the client and server must move together —
there is no compatibility shim, because both are deployed from this repo.

Run with --dry-run first: it prints every file and the exact pairs it would
rewrite.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Ordered: longer, more specific names first so "pendingWool" is not partially
# consumed by a later "Wool" rule.
RENAMES = [
    ('woolPerShiftMin', 'yieldPerRunMin'),
    ('woolPerShiftMax', 'yieldPerRunMax'),
    ('woolPerShift', 'yieldPerRun'),
    ('pendingWool', 'pendingYield'),
    ('refEarnedWool', 'refEarned'),
    ('shiftDurationMs', 'runDurationMs'),
    ('workEndTime', 'runEndTime'),
    ('withdrawalMinWool', 'withdrawalMin'),
    ('insufficient_wool', 'insufficient_balance'),
    ('toast_insufficient_wool', 'toast_insufficient_balance'),
    ('withdraw_wool_amount', 'withdraw_amount'),
    ('task_reward_wool', 'task_reward'),
    ('val-pendingWool', 'val-pendingYield'),
    ('val-refEarnedWool', 'val-refEarned'),
    ('sheep-pen', 'mascot-pen'),
    ('sheep-img', 'mascot-img'),
    ('wool-particles', 'yield-particles'),
    ('val-wool', 'val-balance'),
    ('wool.png', 'currency.png'),
    ('spawnWoolReward', 'spawnYieldReward'),
    ('INSUFFICIENT_WOOL', 'INSUFFICIENT_BALANCE'),
    ('/wool', '/balance'),
    # bare identifiers last
    ('wool', 'balance'),
    ('Wool', 'Balance'),
    ('sheep', 'mascot'),
    ('Sheep', 'Mascot'),
]

TARGETS = [
    'apps/web/src',
    'apps/api/lib',
    'apps/api/test',
    'apps/api/app.js',
    'apps/api/fixtures',
]

SKIP_SUFFIX = ('.woff2', '.png', '.gif', '.mp3', '.jpg')
SKIP_DIRS = {'node_modules', 'dist', '.git'}


def files():
    for target in TARGETS:
        p = ROOT / target
        if p.is_file():
            yield p
            continue
        for f in sorted(p.rglob('*')):
            if not f.is_file() or f.suffix in SKIP_SUFFIX:
                continue
            if SKIP_DIRS & set(f.parts):
                continue
            yield f


def main(argv):
    dry = '--dry-run' in argv
    # Locale JSON carries translated words, not identifiers: only structural
    # keys are renamed there, which RENAMES handles as plain substrings.
    totals = {}
    touched = []

    for path in files():
        original = path.read_text(encoding='utf-8')
        text = original
        hits = []
        for old, new in RENAMES:
            if old in text:
                count = text.count(old)
                hits.append((old, new, count))
                text = text.replace(old, new)
        if text != original:
            totals[path.relative_to(ROOT)] = hits
            touched.append(path)
            if not dry:
                path.write_text(text, encoding='utf-8')

    for rel, hits in sorted(totals.items()):
        total = sum(h[2] for h in hits)
        print(f'{str(rel):46s} {total:4d}  {", ".join(f"{o}->{n}" for o, n, _ in hits[:3])}')
    print(f'\n{len(touched)} files, {sum(sum(h[2] for h in v) for v in totals.values())} replacements'
          f'{" (dry run)" if dry else ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
