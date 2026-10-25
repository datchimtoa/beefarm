import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, emptyUser } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';

// The yield is randomised per shift, so tests must use the amount actually
// credited rather than a fixed constant.
const perShiftBonus = (credited) => Math.floor(credited * 0.1);

function make(config = {}) {
  let clock = 1_700_000_000_000;
  const store = new MemoryStore(config);
  const eco = new Economy({ store, now: () => clock });
  return { eco, store, advance: (ms) => (clock += ms) };
}

async function seedPair(opts = {}) {
  const { eco, store, advance } = make(opts.config ?? {});
  await store.putUser(emptyUser('1', 0)); // referrer
  await store.putUser(emptyUser('2', 0)); // referee
  await eco.registerReferral('2', '1');
  return { eco, store, advance };
}

test('harvesting pays the referrer 10% of the credited balance', async () => {
  const { eco, store, advance } = await seedPair();

  await eco.harvest('2');
  advance(3 * 60 * 1000);
  const done = await eco.harvest('2');

  const expected = perShiftBonus(done.credited);
  assert.deepEqual(done.referral, { referrerId: '1', bonus: expected });

  const referrer = await store.getUser('1');
  assert.equal(referrer.balance, expected);
  assert.equal(referrer.refEarned, expected);

  const referee = await store.getUser('2');
  assert.equal(referee.balance, done.credited, 'referee keeps the full amount');
});

test('the referrer is paid again on each subsequent harvest', async () => {
  const { eco, store, advance } = await seedPair();
  let expected = 0;

  for (let i = 0; i < 3; i += 1) {
    await eco.harvest('2');
    advance(3 * 60 * 1000);
    const done = await eco.harvest('2');
    // Yield is randomised, so accumulate the bonus actually granted.
    expected += done.referral ? done.referral.bonus : 0;
  }

  const referrer = await store.getUser('1');
  assert.ok(expected > 0, 'no bonuses were paid');
  assert.equal(referrer.refEarned, expected);
  assert.equal(referrer.balance, expected);
});

test('no referral is paid when the player has no referrer', async () => {
  const { eco, store, advance } = await seedPair();
  await store.putUser(emptyUser('3', 0)); // unrelated player

  await eco.harvest('3');
  advance(3 * 60 * 1000);
  const done = await eco.harvest('3');
  assert.equal(done.referral, null);
});

test('a banned referrer earns nothing, but the referee still harvests', async () => {
  const { eco, store, advance } = await seedPair();
  const referrer = await store.getUser('1');
  await store.putUser({ ...referrer, banned: true });

  await eco.harvest('2');
  advance(3 * 60 * 1000);
  const done = await eco.harvest('2');

  assert.equal(done.referral, null);
  assert.ok(done.balance > 0, 'referee is unaffected');
  assert.equal((await store.getUser('1')).balance, 0);
});

test('refPercent is honoured from live config, including 0', async () => {
  const zero = await seedPair({ config: { refPercent: 0 } });
  await zero.eco.harvest('2');
  zero.advance(3 * 60 * 1000);
  assert.equal((await zero.eco.harvest('2')).referral, null);
  assert.equal((await zero.store.getUser('1')).balance, 0);

  const twenty = await seedPair({ config: { refPercent: 20 } });
  await twenty.eco.harvest('2');
  twenty.advance(3 * 60 * 1000);
  const done = await twenty.eco.harvest('2');
  assert.equal(done.referral.bonus, Math.floor(done.credited * 0.2));
});

test('a self-referral never pays out', async () => {
  const { eco, store, advance } = make();
  await store.putUser(emptyUser('5', 0));
  const reg = await eco.registerReferral('5', '5');
  assert.equal(reg.ok, false);
  assert.equal(reg.ignored, 'self');

  await eco.harvest('5');
  advance(3 * 60 * 1000);
  const done = await eco.harvest('5');
  assert.equal(done.referral, null);
  assert.ok(done.balance > 0, 'no self-bonus added');
});

test('the referral link is recorded only once', async () => {
  const { eco, store } = make();
  await store.putUser(emptyUser('1', 0));
  await store.putUser(emptyUser('2', 0));
  await store.putUser(emptyUser('3', 0));

  assert.equal((await eco.registerReferral('2', '1')).ok, true);
  const second = await eco.registerReferral('2', '3');
  assert.equal(second.ignored, 'already_referred');

  assert.equal((await store.getUser('1')).referrals, 1);
  assert.equal((await store.getUser('3')).referrals, 0, 'the late referrer gets nothing');
});

test('unknown referrer is ignored without breaking the new player', async () => {
  const { eco, store } = make();
  await store.putUser(emptyUser('2', 0));
  const res = await eco.registerReferral('2', '999');
  assert.equal(res.ignored, 'unknown_referrer');
  assert.equal((await store.getUser('2')).referredBy, undefined);
});

test('REGRESSION: concurrent harvests do not lose referral payouts', async () => {
  // The first implementation read the referrer, added the bonus and wrote the
  // whole record back. Six referees harvesting at once credited only one
  // bonus (18,235 instead of 109,410). Fixed with store.increment().
  const { eco, store, advance } = make();
  const refereeIds = ['2', '3', '4', '5', '6', '7'];

  await store.putUser(emptyUser('1', 0));
  for (const id of refereeIds) {
    await store.putUser(emptyUser(id, 0));
    await eco.registerReferral(id, '1');
  }
  for (const id of refereeIds) await eco.harvest(id); // start shifts
  advance(3 * 60 * 1000);

  const results = await Promise.all(refereeIds.map((id) => eco.harvest(id))); // harvest together

  // Each referee's yield is randomised, so sum what was actually credited.
  const expected = results.reduce((sum, r) => sum + (r.referral ? r.referral.bonus : 0), 0);
  assert.ok(expected > 0, 'no referral bonuses were paid at all');
  const referrer = await store.getUser('1');
  assert.equal(referrer.balance, expected, 'no lost updates');
  assert.equal(referrer.refEarned, expected);
});
