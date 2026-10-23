#!/usr/bin/env python3
"""Extract the original English string table from the decompiled bundle.

The original kept English inline in the main bundle (the base dictionary) and
shipped the other 31 locales as lazy chunks. That is why there is no `en-*.js`.

Emits apps/web/src/i18n/en.json so the rebuilt client can use the exact same
copy as the original instead of hard-coded strings.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'reference' / 'decompile' / 'original.min.js'
OUT = ROOT / 'apps' / 'web' / 'src' / 'i18n' / 'en.json'


def extract() -> dict:
    src = SRC.read_text(encoding='utf-8')
    # The base (English) table starts at `g={title:"Lucky Sheep Farm"` and ends
    # at the first `},<ident>={` that begins the next lookup table.
    start = src.index('g={title:"Lucky Sheep Farm"') + len('g=')
    end = src.index('},', start) + 1
    body = src[start:end]

    entries = {}
    # key:"value" pairs; values may contain escaped quotes and {placeholders}.
    for m in re.finditer(r'([a-z0-9_]+):"((?:[^"\\]|\\.)*)"', body):
        key, raw = m.group(1), m.group(2)
        entries[key] = json.loads(f'"{raw}"')
    return entries


def main() -> int:
    entries = extract()
    if len(entries) < 100:
        raise SystemExit(f'only {len(entries)} keys extracted; the source format changed')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)} with {len(entries)} keys')
    for key in ('title', 'btn_shear', 'harvest_btn', 'withdraw_btn', 'api_unauthorized'):
        print(f'  {key:20s} {entries.get(key, "<MISSING>")[:44]!r}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
