import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, DEFAULT_CONFIG } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';

function make(config = {}) {
  const store = new MemoryStore(config);
  return { eco: new Economy({ store }), store };
}

/** Start a shift and read back what it will pay. */
async function rollOnce(eco, id) {
  const res = await eco.harvest(id);
  return res.pendingWool;
}

test('a shift pays a value inside the configured range', async () => {
  const { eco } = make();
  for (let i = 0; i < 200; i += 1) {
    const amount = await rollOnce(eco, `u${i}`);
    assert.ok(
      amount >= DEFAULT_CONFIG.woolPerShiftMin && amount <= DEFAULT_CONFIG.woolPerShiftMax,
      `${amount} outside ${DEFAULT_CONFIG.woolPerShiftMin}-${DEFAULT_CONFIG.woolPerShiftMax}`
    );
  }
});

test('the yield varies between shifts, so it does not look fixed', async () => {
  // A single constant number reads as machine-made; players notice immediately.
  const { eco } = make();
  const amounts = new Set();
  for (let i = 0; i < 50; i += 1) amounts.add(await rollOnce(eco, `v${i}`));
  assert.ok(amounts.size > 5, `expected varied yields, saw ${amounts.size} distinct values`);
});

test('yields are whole hundreds, like plausible real output', async () => {
  const { eco } = make();
  for (let i = 0; i < 100; i += 1) {
    const amount = await rollOnce(eco, `h${i}`);
    assert.equal(amount % 100, 0, `${amount} is not a multiple of 100`);
  }
});

test('the average stays near the previous fixed payout', async () => {
  // Randomising must not quietly change the economy.
  const { eco } = make();
  let total = 0;
  const n = 500;
  for (let i = 0; i < n; i += 1) total += await rollOnce(eco, `a${i}`);
  const average = total / n;
  const midpoint = (DEFAULT_CONFIG.woolPerShiftMin + DEFAULT_CONFIG.woolPerShiftMax) / 2;
  assert.ok(Math.abs(average - midpoint) < 4000, `average ${average} drifted from ${midpoint}`);
});

test('a legacy fixed woolPerShift is used when the range is unusable', async () => {
  // An inverted range (max < min) is the only thing that counts as absent.
  // min === max is a legitimate fixed range and must be honoured instead.
  const economy = new Economy({
    store: new MemoryStore({ woolPerShift: 50_000, woolPerShiftMin: 90, woolPerShiftMax: 10 }),
  });
  const res = await economy.harvest('legacy');
  assert.equal(res.pendingWool, 50_000, 'fixed value must be used when the range is unusable');
});

test('min === max is a fixed range, not a missing one', async () => {
  const economy = new Economy({
    store: new MemoryStore({ woolPerShift: 50_000, woolPerShiftMin: 10, woolPerShiftMax: 10 }),
  });
  const res = await economy.harvest('fixed');
  assert.equal(res.pendingWool, 10, 'the range must win over the legacy constant');
});

test('a configured range is respected exactly', async () => {
  const economy = new Economy({
    store: new MemoryStore({ woolPerShiftMin: 1000, woolPerShiftMax: 1100 }),
  });
  for (let i = 0; i < 50; i += 1) {
    const res = await economy.harvest(`r${i}`);
    assert.ok(res.pendingWool >= 1000 && res.pendingWool <= 1100, `got ${res.pendingWool}`);
  }
});

test('the amount is decided by the server, not the client', async () => {
  // harvest() takes no amount argument; the client cannot influence the payout.
  const { eco } = make();
  const res = await eco.harvest('trust', { adToken: undefined, wool: 999_999_999 });
  assert.ok(res.pendingWool <= DEFAULT_CONFIG.woolPerShiftMax);
  assert.notEqual(res.pendingWool, 999_999_999);
});
