import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web');
const RENDER = readFileSync(join(WEB, 'src', 'render.js'), 'utf8');
const MAIN = readFileSync(join(WEB, 'src', 'main.js'), 'utf8');
const EFFECTS = readFileSync(join(WEB, 'src', 'effects.js'), 'utf8');
const CSS = readFileSync(join(WEB, 'public', 'assets', 'index.css'), 'utf8');
const ORIGINAL = readFileSync(join(HERE, '..', '..', '..', 'reference', 'decompile', 'original.min.js'), 'utf8');

function installDom() {
  const created = [];
  globalThis.document = {
    createElement: () => {
      const el = {
        className: '',
        innerHTML: '',
        style: { setProperty(k, v) { this[k] = v; }, },
        remove() {},
      };
      created.push(el);
      return el;
    },
  };
  return created;
}

function makeHost() {
  return {
    children: [],
    childElementCount: 0,
    appendChild(el) {
      this.children.push(el);
      this.childElementCount += 1;
    },
    removeChild(el) {
      this.children = this.children.filter((c) => c !== el);
    },
  };
}

test('the CSS keyframes the effects rely on exist', () => {
  // Without these the classes are inert: the elements are created but never move.
  assert.ok(CSS.includes('@keyframes floatUp'), 'floatUp keyframe missing');
  assert.ok(CSS.includes('@keyframes flyOutStrand'), 'flyOutStrand keyframe missing');
  assert.ok(CSS.includes('.wool-particle'), '.wool-particle class missing (stylesheet must stay as-shipped)');
  assert.ok(CSS.includes('.crescent-strand'), '.crescent-strand class missing');
});

test('spawnYieldReward creates the same node the original did', async () => {
  const created = installDom();
  const { spawnYieldReward } = await import('../../web/src/effects.js');
  const host = makeHost();

  spawnYieldReward(host, '182,351');

  assert.equal(host.children.length, 1);
  const el = created.at(-1);
  assert.ok(el.className.includes('wool-particle'), `got "${el.className}"`);
  assert.ok(el.innerHTML.startsWith('+182,351'), `got "${el.innerHTML.slice(0, 20)}"`);
  assert.ok(el.innerHTML.includes('/currency.png'), 'balance icon missing');
});

test('startShearEffect spawns 1-3 strands per tick, like the original', async () => {
  const created = installDom();
  let tick = null;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  globalThis.setTimeout = () => 0;

  const { startShearEffect, stopShearEffect } = await import('../../web/src/effects.js');
  const host = makeHost();
  startShearEffect(host);

  assert.ok(tick, 'no interval registered');
  for (let i = 0; i < 20; i += 1) tick();

  const strands = host.children.filter((c) => c.className === 'crescent-strand');
  assert.ok(strands.length >= 20, `expected >= 20 strands over 20 ticks, got ${strands.length}`);
  assert.ok(strands.length <= 60, `expected <= 60 strands over 20 ticks, got ${strands.length}`);

  const first = strands[0];
  assert.ok(first.style['--tx'] && first.style['--ty'] && first.style['--rot'],
    'animation custom properties not set');

  stopShearEffect();
  assert.equal(tick, null, 'interval not cleared');
});

test('the original had these same two effects', () => {
  // Guards against "helpfully" reinventing them differently.
  assert.ok(ORIGINAL.includes('crescent-strand'), 'original used crescent-strand');
  // Asserting against the original must use the ORIGINAL's identifier, not
  // our renamed one: a blanket rename here makes the test unfalsifiable.
  assert.ok(ORIGINAL.includes('wool-particle'), 'original used wool-particle');
});

test('render toggles strands and scissors with the shift phase', () => {
  const working = RENDER.slice(RENDER.indexOf("btn.dataset.phase = 'working';"));
  assert.ok(working.includes('startShearEffect'), 'strands not started while working');
  assert.ok(working.includes("scissors-img") && working.includes("remove('hidden')"),
    'scissors GIF not shown while working');

  const idle = RENDER.slice(RENDER.indexOf("btn.dataset.phase = 'start';"));
  assert.ok(idle.slice(0, 200).includes('stopShearEffect'), 'strands not stopped when idle');
  assert.ok(idle.slice(0, 240).includes("scissors-img"), 'scissors not hidden when idle');
});

test('harvesting floats the reward text', () => {
  assert.ok(MAIN.includes('spawnYieldReward'), 'harvest does not spawn the reward text');
  assert.ok(MAIN.includes("el('yield-particles')"), 'reward text not attached to its host');
});

test('the offline modal is wired to the browser events', () => {
  const conn = readFileSync(join(WEB, 'src', 'connection.js'), 'utf8');
  assert.ok(conn.includes("addEventListener('offline'"), 'offline event not handled');
  assert.ok(conn.includes("addEventListener('online'"), 'online event not handled');
  assert.ok(conn.includes('no-internet-modal'), 'modal not used');
  assert.ok(conn.includes('pointerEvents'), 'input not blocked while offline');
  assert.ok(MAIN.includes('bindConnectionWatcher()'), 'watcher never bound');
});
