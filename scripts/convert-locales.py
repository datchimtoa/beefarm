#!/usr/bin/env python3
"""Convert the 31 lazy locale chunks into plain JSON under apps/web/src/i18n/.

The originals are ESM chunks (`const t={key:"value",...};export{t as default}`)
named by content hash (ko-qw8R2uUY.js). Copying them verbatim would mean
bundling hashed filenames and an import map, so instead the tables are lifted
into locale-keyed JSON that the client imports dynamically.

Expected output: ar.json, be.json, ... zh-hant.json (31) plus en.json from
scripts/extract-i18n.py (32 total).
"""
import glob
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / 'reference' / 'original-site' / 'assets-index'
OUT_DIR = ROOT / 'apps' / 'web' / 'src' / 'i18n'

# Vite emits chunk names as "<locale>-<contenthash>.js", where the locale may
# itself contain a hyphen ("pt-br", "zh-hans"). A 2-letter pattern silently
# collapsed zh-hans and zh-hant into "zh" and one overwrote the other, so match
# against the known locale list instead of guessing from the filename shape.
KNOWN = [
    'ar', 'be', 'ca', 'cs', 'de', 'es', 'fa', 'fi', 'fr', 'he', 'hr', 'hu',
    'id', 'it', 'kk', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt-br', 'ro', 'ru', 'sk',
    'sr', 'sv', 'tr', 'uk', 'uz', 'vi', 'zh-hans', 'zh-hant', 'en',
]


def locale_for(name: str) -> str | None:
    """Longest matching known locale that prefixes the chunk filename."""
    for locale in sorted(KNOWN, key=len, reverse=True):
        if name.startswith(f'{locale}-'):
            return locale
    return None



def parse_table(text: str) -> dict:
    """Pull key:"value" pairs out of a `const t={...}` literal."""
    start = text.index('{')
    end = text.rindex('}')
    body = text[start:end + 1]
    table = {}
    for m in re.finditer(r'(?<![\w$])([a-zA-Z][a-zA-Z0-9_]*):"((?:[^"\\]|\\.)*)"', body):
        table[m.group(1)] = json.loads(f'"{m.group(2)}"')
    return table


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for path in sorted(glob.glob(str(SRC_DIR / '*.js'))):
        name = Path(path).name
        locale = locale_for(name)
        if not locale:
            print(f'  skip (unrecognised name): {name}')
            continue
        table = parse_table(Path(path).read_text(encoding='utf-8'))
        if len(table) < 90:
            print(f'  WARN {locale}: only {len(table)} keys')
        out = OUT_DIR / f'{locale}.json'
        out.write_text(json.dumps(table, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        written.append((locale, len(table)))

    print(f'wrote {len(written)} locale files to {OUT_DIR.relative_to(ROOT)}')
    for locale, n in written:
        print(f'  {locale:9s} {n} keys')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
