import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(HERE, '..', '..', 'web', 'src', 'i18n');

const load = (name) => JSON.parse(readFileSync(join(I18N_DIR, `${name}.json`), 'utf8'));
const locales = readdirSync(I18N_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

test('there are 32 chunk locales plus the inline English table', () => {
  // The original shipped 31 lazy locale chunks and kept English inline in the
  // main bundle; conversion produced en.json as well, so 33 files total.
  assert.equal(locales.length, 33, `got ${locales.length}`);
  assert.ok(locales.includes('en'));
  assert.ok(locales.includes('zh-hans') && locales.includes('zh-hant'));
});

test('simplified and traditional Chinese are not collapsed', () => {
  const hans = load('zh-hans');
  const hant = load('zh-hant');
  assert.notEqual(hans.tab_tasks, hant.tab_tasks);
});

test('English has the keys the markup and client rely on', () => {
  const en = load('en');
  const required = [
    'title', 'btn_shear', 'harvest_btn', 'withdraw_btn', 'status_ready',
    'status_waiting', 'tab_farm', 'tab_tasks', 'tab_friends', 'tab_withdraw',
    'toast_collect_success', 'withdraw_min', 'api_unauthorized',
  ];
  for (const key of required) {
    assert.ok(key in en, `missing key: ${key}`);
  }
});

test('every locale defines the same key set as English', () => {
  const en = load('en');
  const enKeys = new Set(Object.keys(en));
  const problems = [];
  for (const locale of locales) {
    const table = load(locale);
    const missing = [...enKeys].filter((k) => !(k in table));
    if (missing.length) problems.push(`${locale}: missing ${missing.length} (${missing.slice(0, 3)})`);
  }
  assert.deepEqual(problems, []);
});

test('placeholders in English survive translation', () => {
  const en = load('en');
  const withPlaceholders = Object.entries(en).filter(([, v]) => /\{[a-z]+\}/.test(v));
  assert.ok(withPlaceholders.length >= 10, `only ${withPlaceholders.length} placeholder keys`);

  const broken = [];
  for (const [key, value] of withPlaceholders) {
    const names = (s) => (s.match(/\{([a-z]+)\}/g) ?? []).sort().join(',');
    for (const locale of locales) {
      const translated = load(locale)[key];
      if (!translated) continue;
      if (names(translated) !== names(value)) {
        broken.push(`${locale}/${key}: ${names(translated)} != ${names(value)}`);
      }
    }
  }
  assert.deepEqual(broken.slice(0, 5), [], 'placeholder mismatch');
});

test('no locale is empty', () => {
  for (const locale of locales) {
    const table = load(locale);
    assert.ok(Object.keys(table).length > 90, `${locale} has ${Object.keys(table).length} keys`);
  }
});
