import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web');
const HTML = readFileSync(join(WEB, 'src', 'index.html'), 'utf8');
const FONT_CSS = readFileSync(join(WEB, 'public', 'assets', 'fonts', 'nunito.css'), 'utf8');

test('fonts are self-hosted, not loaded from Google', () => {
  // The original pulled Nunito from fonts.googleapis.com at runtime, which made
  // text rendering depend on a third-party CDN and on font-swap timing.
  const liveTags = HTML.split('\n').filter(
    (line) => !line.trim().startsWith('<!--') && !line.trim().startsWith('fonts.googleapis.com')
  );
  const offenders = liveTags.filter(
    (line) => line.includes('fonts.googleapis.com') || line.includes('fonts.gstatic.com')
  );
  assert.deepEqual(offenders, [], 'external font <link> reintroduced');
  assert.ok(HTML.includes('/assets/fonts/nunito.css'), 'local font stylesheet missing');
});

test('the local font stylesheet only references files that exist', () => {
  const dir = join(WEB, 'public', 'assets', 'fonts');
  const refs = [...FONT_CSS.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, `expected at least 5 font files, got ${refs.length}`);

  const missing = refs.filter((ref) => {
    const rel = ref.replace(/^\/assets\/fonts\//, '');
    return !existsSync(join(dir, rel));
  });
  assert.deepEqual(missing, [], 'font stylesheet points at a missing file');
});

test('all three Nunito weights are declared', () => {
  for (const weight of ['400', '700', '900']) {
    assert.ok(
      new RegExp(`font-weight:\\s*${weight};`).test(FONT_CSS),
      `weight ${weight} missing from nunito.css`
    );
  }
});

test('woff2 files are present and non-empty', () => {
  const dir = join(WEB, 'public', 'assets', 'fonts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.woff2'));
  assert.ok(files.length >= 5, `expected >= 5 woff2 files, found ${files.length}`);
  for (const file of files) {
    const size = readFileSync(join(dir, file)).length;
    assert.ok(size > 1000, `${file} looks empty (${size} bytes)`);
  }
});

test('Tailwind is vendored and pinned, not fetched from the CDN', () => {
  // cdn.tailwindcss.com 302s to whatever version is current, so styling could
  // drift between deploys.
  const liveScripts = HTML.split('\n').filter((line) => !line.trim().startsWith('<!--'));
  const cdn = liveScripts.filter((line) => line.includes('cdn.tailwindcss.com'));
  assert.deepEqual(cdn, [], 'Tailwind CDN reintroduced');

  assert.ok(HTML.includes('/assets/vendor/tailwind-3.4.17.js'), 'pinned Tailwind missing');
  const vendored = join(WEB, 'public', 'assets', 'vendor', 'tailwind-3.4.17.js');
  assert.ok(existsSync(vendored), 'vendored Tailwind file missing');
  assert.ok(readFileSync(vendored).length > 100_000, 'vendored Tailwind looks truncated');
});
