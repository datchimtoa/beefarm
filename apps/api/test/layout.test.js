import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web');
const RENDER = readFileSync(join(WEB, 'src', 'render.js'), 'utf8');
const HTML = readFileSync(join(WEB, 'src', 'index.html'), 'utf8');
const LAYOUT = readFileSync(join(WEB, 'public', 'assets', 'layout-fixes.css'), 'utf8');

test('THE BUTTON BUG: #normal-action-cards is never hidden', () => {
  // The SHEAR button lives inside #normal-action-cards. Hiding that container
  // removed the button entirely, and because the idle state also stopped
  // re-fetching, nothing ever brought it back — it stayed gone even on reload.
  // The original only ever removed 'hidden' from it.
  const hides = RENDER.match(/normal-action-cards'\)\?\.classList\.add\('hidden'\)/g);
  assert.equal(hides, null, 'nothing may add "hidden" to #normal-action-cards');

  const shows = RENDER.match(/normal-action-cards'\)\?\.classList\.remove\('hidden'\)/g) ?? [];
  assert.ok(shows.length >= 3, `every phase should reveal it, found ${shows.length}`);
});

test('the SHEAR button really is inside normal-action-cards', () => {
  const cards = HTML.indexOf('id="normal-action-cards"');
  const button = HTML.indexOf('id="btn-main-action"');
  assert.ok(cards > 0 && button > 0, 'both elements must exist');
  assert.ok(button > cards, 'btn-main-action must come after its container');
  // and no closing </div> of the container between them
  const between = HTML.slice(cards, button);
  assert.equal(
    (between.match(/<\/div>/g) ?? []).length,
    0,
    'container must not close before the button'
  );
});

test('the layout override is loaded after the original stylesheet', () => {
  const base = HTML.indexOf('/assets/index.css');
  const fixes = HTML.indexOf('/assets/layout-fixes.css');
  assert.ok(base > 0, 'index.css must stay linked');
  assert.ok(fixes > base, 'layout-fixes.css must load after index.css to win the cascade');
});

test('the layout override reclaims the wasted vertical space', () => {
  // pb-32 alone was 128px of dead space at the bottom of the Farm tab.
  assert.ok(/#tab-home\s*\{[^}]*padding-bottom/.test(LAYOUT), 'bottom padding not reduced');
  assert.ok(/#tab-home #sheep-pen\s*\{[^}]*240px/.test(LAYOUT), 'sheep pen not shrunk');

  // Shrinking the pen without moving the absolute-positioned scissors would
  // leave it off-centre.
  assert.ok(/#tab-home #scissors-img\s*\{[^}]*top:/.test(LAYOUT), 'scissors not repositioned');
});

test('the Farm tab structure is unchanged apart from themed alt text', () => {
  const original = readFileSync(
    join(HERE, '..', '..', '..', 'reference', 'decompile', 'original.html'),
    'utf8'
  );
  const tab = (s) => s.slice(s.indexOf('id="tab-home"'), s.indexOf('id="tab-tasks"'));

  // The reskin legitimately changes accessible names (Sheep -> Bee,
  // Scissors -> Honey). Stripping alt/title/placeholder attributes lets the
  // test assert that the STRUCTURE is untouched while allowing themed copy.
  const structure = (s) =>
    tab(s)
      .replace(/\s(alt|title|placeholder)="[^"]*"/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  assert.equal(
    structure(HTML),
    structure(original),
    'Farm tab structure must not change: only themed attributes may differ'
  );
});
