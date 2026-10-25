#!/usr/bin/env python3
"""Apply the bee theme to every locale.

The rebuild keeps sheep-era copy in the 106-key string table: "Lucky Sheep Farm",
"wool", "shear", "farm". Retheming means changing those in all 32 locales, which
is exactly the kind of edit that should be data-driven rather than hand-edited
file by file.

Two stages:

1. English (`en.json`) is rewritten from an explicit, reviewable mapping. Every
   replacement is listed below, so nothing changes silently.
2. The other 31 locales get the *same* substitutions by word, because the
   original translations use each language's own word for "wool" and "sheep".
   A locale that has no known mapping is reported, not silently skipped.

Run with --dry-run to see what would change.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / 'apps' / 'web' / 'src' / 'i18n'

# English source -> bee theme. Ordered longest-first so "Lucky Sheep Farm" wins
# over "Sheep" and "wool truck" over "wool".
EN_MAP = [
    # Explicit key fixes first: a generic she->bee pass produces
    # "Lucky Bee Hive" and "Hiveers", which are wrong.
    ('Lucky Sheep Farm', 'Lucky Bee Farm'),
    ('Recruit Farmers', 'Recruit Beekeepers'),
    ('Invite {count} Farmers', 'Invite {count} Beekeepers'),
    ('Join Farm Channel', 'Join Bee Channel'),
    ('WAITING FOR SHEARING', 'WAITING FOR NECTAR'),
    ('SHEARING WOOL...', 'COLLECTING NECTAR...'),
    ('WOOL TRUCK IS ON THE WAY', 'HONEY TRUCK IS ON THE WAY'),
    ('Shift duration', 'Nectar run duration'),
    ('shearing', 'collecting nectar'),
    ('Shearing', 'Collecting nectar'),
    ('SHEAR', 'COLLECT'),
    ('shear', 'collect nectar'),
    ('Shift', 'Nectar run'),
    ('shift', 'nectar run'),
    ('wool', 'honey'),
    ('Wool', 'Honey'),
    ('sheep', 'bee'),
    ('Sheep', 'Bee'),
    ('farm', 'hive'),   # after the explicit fixes above
    ('Farm', 'Hive'),
]

# Per-language words for the two terms that appear in translations. Only words
# actually present in the shipped copy are listed; anything unmatched is
# reported so it can be added deliberately.
LOCALE_WORDS = {
    'ar': [('صوف', 'عسل'), ('أغنام', 'نحل'), ('خروف', 'نحلة')],
    'be': [('воўна', 'мёд'), ('авечк', 'пчол')],
    'ca': [('llana', 'mel'), ('ovella', 'abella')],
    'cs': [('vlna', 'med'), ('ovc', 'včel')],
    'de': [('Wolle', 'Honig'), ('Schaf', 'Biene')],
    'es': [('lana', 'miel'), ('oveja', 'abeja')],
    'fa': [('پشم', 'عسل'), ('گوسفند', 'زنبور')],
    'fi': [('villa', 'hunaja'), ('lammas', 'mehiläinen')],
    'fr': [('laine', 'miel'), ('mouton', 'abeille')],
    'he': [('צמר', 'דבש'), ('כבש', 'דבורה')],
    'hr': [('vuna', 'med'), ('ovca', 'pčela')],
    'hu': [('gyapjú', 'méz'), ('birka', 'méh')],
    'id': [('wol', 'madu'), ('domba', 'lebah')],
    'it': [('lana', 'miele'), ('pecora', 'ape')],
    'kk': [('жүн', 'бал'), ('қой', 'ара')],
    'ko': [('양털', '꿀'), ('양', '벌')],
    'ms': [('bulu', 'madu'), ('biri-biri', 'lebah')],
    'nb': [('ull', 'honning'), ('sau', 'bie')],
    'nl': [('wol', 'honing'), ('schaap', 'bij')],
    'pl': [('wełna', 'miód'), ('owca', 'pszczoła')],
    'pt-br': [('lã', 'mel'), ('ovelha', 'abelha')],
    'ro': [('lână', 'miere'), ('oaie', 'albină')],
    'ru': [('шерст', 'мёд'), ('овц', 'пчёл')],
    'sk': [('vlna', 'med'), ('ovc', 'včel')],
    'sr': [('вуна', 'мед'), ('овца', 'пчела')],
    'sv': [('ull', 'honung'), ('får', 'bi')],
    'tr': [('yün', 'bal'), ('koyun', 'arı')],
    'uk': [('вовн', 'мед'), ('вівц', 'бджол')],
    'uz': [('jun', 'asal'), ("qo'y", 'asalari')],
    'vi': [('len', 'mật ong'), ('cừu', 'ong')],
    'zh-hans': [('羊毛', '蜂蜜'), ('羊', '蜜蜂')],
    'zh-hant': [('羊毛', '蜂蜜'), ('羊', '蜜蜂')],
}


# Keys whose wording is set outright, then excluded from the generic pass:
# a blanket farm->hive would otherwise turn "Lucky Bee Farm" into "Lucky Bee
# Hive", and "Farmers" into "Hiveers".
EN_EXACT = {
    'title': 'Lucky Bee Farm',
    'ref_title': 'Recruit Beekeepers',
    'task_ref_title': 'Invite {count} Beekeepers',
    'task_title': 'Join Bee Channel',
}


def apply_en(table):
    changed = {}
    for key, value in table.items():
        if key in EN_EXACT:
            new = EN_EXACT[key]
        else:
            new = value
            for old, repl in EN_MAP:
                if old in new:
                    new = new.replace(old, repl)
        if new != value:
            changed[key] = (value, new)
            table[key] = new
    return changed


def apply_locale(code, table):
    words = LOCALE_WORDS.get(code)
    if not words:
        return {}, True
    changed = {}
    for key, value in table.items():
        new = value
        for old, repl in words:
            if old in new:
                new = new.replace(old, repl)
        if new != value:
            changed[key] = (value, new)
            table[key] = new
    return changed, False


def main(argv):
    dry = '--dry-run' in argv
    total = 0
    unmapped = []

    for path in sorted(I18N.glob('*.json')):
        code = path.stem
        table = json.loads(path.read_text(encoding='utf-8'))

        if code == 'en':
            changed = apply_en(table)
        else:
            changed, missing = apply_locale(code, table)
            if missing:
                unmapped.append(code)

        if changed:
            total += len(changed)
            print(f'{code:8s} {len(changed):3d} strings')
            if code == 'en' and dry:
                for k, (old, new) in list(changed.items())[:6]:
                    print(f'           {k}: {old!r} -> {new!r}')
            if not dry:
                path.write_text(
                    json.dumps(table, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
                    encoding='utf-8',
                )

    print(f'\n{total} strings {"would change" if dry else "changed"}')
    if unmapped:
        print(f'no word mapping for: {", ".join(unmapped)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
