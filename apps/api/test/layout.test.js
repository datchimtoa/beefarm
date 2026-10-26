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
  // Sized down from the original 300px. The exact value is a layout choice, so
  // assert the direction rather than a magic number.
  const pen = /#tab-home #mascot-pen\s*\{([^}]*)\}/.exec(LAYOUT)?.[1] ?? '';
  const penWidth = Number(/width:\s*(\d+)px/.exec(pen)?.[1]);
  assert.ok(penWidth >= 180 && penWidth < 300, `mascot pen should be shrunk, got ${penWidth}px`);

  // Shrinking the pen without moving the absolute-positioned scissors would
  // leave it off-centre.
  assert.ok(/#tab-home #scissors-img\s*\{[^}]*top:/.test(LAYOUT), 'scissors not repositioned');
});

test('the Farm tab keeps the original structure but is free to retheme', () => {
  // Byte comparison is the wrong tool once identifiers are rethemed: it fails
  // on renames while still missing a genuinely dropped element. Comparing the
  // extracted STRUCTURE (tag names + class lists) catches the thing that matters.
  //
  // Colour and theme utilities must NOT be compared. They encode the sheep
  // artwork (game-btn-green, the wool palette); pinning them would make the
  // honey retheme a test failure forever, which is backwards — the structure is
  // what must survive, the skin is what we are deliberately changing.
  const original = readFileSync(
    join(HERE, '..', '..', '..', 'reference', 'decompile', 'original.html'),
    'utf8'
  );
  const tab = (s) => s.slice(s.indexOf('id="tab-home"'), s.indexOf('id="tab-tasks"'));

  // Theme-only utilities, dropped before comparing. These name colours and
  // art, not structure, so they differ legitimately between the sheep original
  // and the honey reskin.
  const THEME_CLASS = /^(game-btn-|text-\[#|bg-\[#|text-stroke|drop-shadow|shadow)/;

  // Structural fingerprint: every tag with its class attribute, in order.
  const shape = (s) =>
    [...tab(s).matchAll(/<(\w+)([^>]*)>/g)].map(([, tag, attrs]) => {
      const cls = /class="([^"]*)"/.exec(attrs);
      const kept = cls
        ? cls[1].split(/\s+/).filter((c) => c && !THEME_CLASS.test(c)).sort()
        : [];
      return `${tag}.${kept.join('.')}`;
    });

  assert.deepEqual(
    shape(HTML),
    shape(original),
    'the Farm tab must contain the same tags and classes as the original'
  );
});

