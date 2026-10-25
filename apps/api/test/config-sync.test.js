import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store-memory.js';
import { Economy, DEFAULT_CONFIG } from '../lib/economy.js';

test('putConfig merges instead of replacing', async () => {
  // An admin changing one value must not wipe the rest of the config.
  const store = new MemoryStore({ minWithdraw: 1, rateTon: 10, refPercent: 5 });
  await store.putConfig({ refPercent: 20 });

  const cfg = await store.getConfig();
  assert.equal(cfg.refPercent, 20, 'changed value applied');
  assert.equal(cfg.minWithdraw, 1, 'untouched value preserved');
  assert.equal(cfg.rateTon, 10, 'untouched value preserved');
});

test('the fixture covers every key DEFAULT_CONFIG declares', async () => {
  // A seed missing a key makes the live database look like it disagrees with
  // the code, which is exactly the confusion that hid the yield range.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(
    readFileSync(join(here, '..', 'fixtures', 'system_config.json'), 'utf8')
  ).system_config;

  const missing = Object.keys(DEFAULT_CONFIG).filter(
    (k) => k !== 'tasks' && !(k in fixture)
  );
  assert.deepEqual(missing, [], `fixture is missing: ${missing}`);
});

test('the fixture values match DEFAULT_CONFIG', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(
    readFileSync(join(here, '..', 'fixtures', 'system_config.json'), 'utf8')
  ).system_config;

  const mismatched = Object.entries(fixture).filter(
    ([k, v]) => DEFAULT_CONFIG[k] !== v
  );
  assert.deepEqual(mismatched, [], `mismatched keys: ${mismatched.map(([k]) => k)}`);
});

test('a stored config overrides the defaults, and the rest still applies', async () => {
  // Live databases predate the yield range; the merge must keep the range.
  const store = new MemoryStore({ yieldPerRun: 182351, refPercent: 10 });
  const eco = new Economy({ store });
  const cfg = await eco.config();

  assert.equal(cfg.yieldPerRun, 182351, 'stored value wins');
  assert.equal(cfg.yieldPerRunMin, DEFAULT_CONFIG.yieldPerRunMin, 'range still applies');
  assert.equal(cfg.yieldPerRunMax, DEFAULT_CONFIG.yieldPerRunMax);
});

test('an admin can change the yield range at runtime', async () => {
  const store = new MemoryStore();
  const eco = new Economy({ store });

  await store.putConfig({ yieldPerRunMin: 1000, yieldPerRunMax: 1000 });
  const res = await eco.harvest('admin');
  assert.equal(res.pendingYield, 1000, 'the new range takes effect without a restart');
});
