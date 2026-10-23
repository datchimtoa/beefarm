// Localisation.
//
// Mirrors the original's `k(key, params)` helper: look the key up in the active
// locale, fall back to English, and finally to the key itself so a missing
// string is visible rather than blank.
//
// Unlike the original, English is a real table (en.json) rather than inline
// strings, and locale files are plain JSON imported dynamically, so only the
// selected locale is fetched.

const AVAILABLE = [
  'ar', 'be', 'ca', 'cs', 'de', 'es', 'fa', 'fi', 'fr', 'he', 'hr', 'hu', 'id',
  'it', 'kk', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt-br', 'ro', 'ru', 'sk', 'sr',
  'sv', 'tr', 'uk', 'uz', 'vi', 'zh-hans', 'zh-hant', 'en',
];

// Locale codes differ between Telegram (short) and BCP-47; the original used
// this same mapping to pick a chunk.
const TELEGRAM_TO_LOCALE = {
  'zh-hans': 'zh-hans',
  'zh-hant': 'zh-hant',
  'pt-br': 'pt-br',
};

/**
 * Explicit importer map.
 *
 * Rollup cannot resolve `import(`./i18n/${code}.json`)` at build time, so a
 * purely dynamic path silently drops every locale from the bundle (only English
 * survived). The original bundle solved this the same way: an explicit map of
 * `"./lang/xx.js": () => import("./xx-<hash>.js")`.
 */
const IMPORTERS = {
  ar: () => import('./i18n/ar.json', { with: { type: 'json' } }),
  be: () => import('./i18n/be.json', { with: { type: 'json' } }),
  ca: () => import('./i18n/ca.json', { with: { type: 'json' } }),
  cs: () => import('./i18n/cs.json', { with: { type: 'json' } }),
  de: () => import('./i18n/de.json', { with: { type: 'json' } }),
  es: () => import('./i18n/es.json', { with: { type: 'json' } }),
  fa: () => import('./i18n/fa.json', { with: { type: 'json' } }),
  fi: () => import('./i18n/fi.json', { with: { type: 'json' } }),
  fr: () => import('./i18n/fr.json', { with: { type: 'json' } }),
  he: () => import('./i18n/he.json', { with: { type: 'json' } }),
  hr: () => import('./i18n/hr.json', { with: { type: 'json' } }),
  hu: () => import('./i18n/hu.json', { with: { type: 'json' } }),
  id: () => import('./i18n/id.json', { with: { type: 'json' } }),
  it: () => import('./i18n/it.json', { with: { type: 'json' } }),
  kk: () => import('./i18n/kk.json', { with: { type: 'json' } }),
  ko: () => import('./i18n/ko.json', { with: { type: 'json' } }),
  ms: () => import('./i18n/ms.json', { with: { type: 'json' } }),
  nb: () => import('./i18n/nb.json', { with: { type: 'json' } }),
  nl: () => import('./i18n/nl.json', { with: { type: 'json' } }),
  pl: () => import('./i18n/pl.json', { with: { type: 'json' } }),
  'pt-br': () => import('./i18n/pt-br.json', { with: { type: 'json' } }),
  ro: () => import('./i18n/ro.json', { with: { type: 'json' } }),
  ru: () => import('./i18n/ru.json', { with: { type: 'json' } }),
  sk: () => import('./i18n/sk.json', { with: { type: 'json' } }),
  sr: () => import('./i18n/sr.json', { with: { type: 'json' } }),
  sv: () => import('./i18n/sv.json', { with: { type: 'json' } }),
  tr: () => import('./i18n/tr.json', { with: { type: 'json' } }),
  uk: () => import('./i18n/uk.json', { with: { type: 'json' } }),
  uz: () => import('./i18n/uz.json', { with: { type: 'json' } }),
  vi: () => import('./i18n/vi.json', { with: { type: 'json' } }),
  'zh-hans': () => import('./i18n/zh-hans.json', { with: { type: 'json' } }),
  'zh-hant': () => import('./i18n/zh-hant.json', { with: { type: 'json' } }),
};

let table = {};
let fallback = {};
let current = 'en';

/** Load a locale (and English as the fallback) into memory. */
export async function loadLocale(locale) {
  const target = TELEGRAM_TO_LOCALE[locale] ?? locale;
  const chosen = AVAILABLE.includes(target) ? target : 'en';

  if (!Object.keys(fallback).length) {
    fallback = (await import('./i18n/en.json', { with: { type: 'json' } })).default;
  }

  if (chosen === 'en') {
    table = fallback;
    current = 'en';
    return 'en';
  }

  const load = IMPORTERS[chosen];
  if (!load) {
    table = fallback;
    current = 'en';
    return 'en';
  }
  try {
    table = (await load()).default;
    current = chosen;
  } catch {
    // Unknown or failed to load: keep English rather than showing raw keys.
    table = fallback;
    current = 'en';
  }
  return current;
}

export function locale() {
  return current;
}

export function availableLocales() {
  return [...AVAILABLE];
}

/**
 * Translate a key. `params` fills `{name}` placeholders, matching the original.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 */
export function t(key, params) {
  const raw = table[key] ?? fallback[key] ?? key;
  if (!params) return raw;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    raw
  );
}

/** Stopgap alias kept while call sites migrate from the old helper name. */
export const tr = t;
