import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, ERR, emptyUser } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { assertPlausibleYield } from './yield-helpers.js';

const BOT = '1:token';
const WALLET = 'UQAbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFGHIJ'; // 48 chars: user-friendly + 46 base64

function makeEconomy(opts = {}) {
  let clock = 1_700_000_000_000;
  const store = new MemoryStore(opts.config ?? {});
  const eco = new Economy({ store, now: () => clock });
  return {
    eco,
    store,
    advance(ms) { clock += ms; },
    setTime(ms) { clock = ms; },
    now() { return clock; },
  };
}

const alwaysMember = async () => true;
const neverMember = async () => false;

test('a shift cannot be double-credited', async () => {
  const { eco, advance } = makeEconomy();
  const start = await eco.harvest('42');
  assert.equal(start.phase, 'shift_started');
  assertPlausibleYield(assert, start.pendingWool, 'pendingWool');

  const tooEarly = await eco.harvest('42');
  assert.equal(tooEarly.error, ERR.NOT_READY);

  advance(3 * 60 * 1000);
  const done = await eco.harvest('42');
  assert.equal(done.phase, 'harvest');
  assertPlausibleYield(assert, done.wool, 'credited wool');

  // A second harvest with nothing pending must start a new shift, not pay again.
  const again = await eco.harvest('42');
  assert.equal(again.phase, 'shift_started');
  assertPlausibleYield(assert, (await eco.user('42')).wool, 'stored wool');
});

test('task reward is paid once and requires membership', async () => {
  const { eco } = makeEconomy();
  const denied = await eco.claimTask('42', 't1', neverMember);
  assert.equal(denied.error, ERR.NOT_MEMBER);

  const ok = await eco.claimTask('42', 't1', alwaysMember);
  assert.equal(ok.ok, true);
  assert.equal(ok.wool, 5_000);

  const dup = await eco.claimTask('42', 't1', alwaysMember);
  assert.equal(dup.error, ERR.ALREADY_CLAIMED);

  const unknown = await eco.claimTask('42', 'nope', alwaysMember);
  assert.equal(unknown.error, ERR.NOT_FOUND);
});

test('withdrawal rejects bad input, then enforces the daily cap', async () => {
  const { eco, store } = makeEconomy();
  await store.putUser({ ...emptyUser('42', 0), wool: 20_000_000 });

  assert.equal((await eco.requestWithdraw('42', { wallet: WALLET, amount: 0 })).error, ERR.INVALID_AMOUNT);
  assert.equal((await eco.requestWithdraw('42', { wallet: 'x', amount: 5_000_000 })).error, ERR.INVALID_WALLET);
  assert.equal((await eco.requestWithdraw('42', { wallet: WALLET, amount: 100 })).error, ERR.MIN_WITHDRAW);
  assert.equal((await eco.requestWithdraw('42', { wallet: WALLET, amount: 99_000_000 })).error, ERR.INSUFFICIENT_WOOL);

  const first = await eco.requestWithdraw('42', { wallet: WALLET, amount: 4_500_000 });
  assert.equal(first.ok, true);
  assert.equal(first.wool, 15_500_000, 'funds held immediately');
  assert.equal(first.withdrawal.gram, 0.01);

  // Same settlement window -> blocked by maxWithdrawsPerDay = 1.
  const second = await eco.requestWithdraw('42', { wallet: WALLET, amount: 4_500_000 });
  assert.equal(second.error, ERR.DAILY_LIMIT);
});

test('withdrawal cap resets in the next settlement window', async () => {
  const { eco, store, advance } = makeEconomy();
  await store.putUser({ ...emptyUser('42', 0), wool: 20_000_000 });
  assert.equal((await eco.requestWithdraw('42', { wallet: WALLET, amount: 4_500_000 })).ok, true);

  advance(26 * 60 * 60 * 1000); // more than a day later
  const next = await eco.requestWithdraw('42', { wallet: WALLET, amount: 4_500_000 });
  assert.equal(next.ok, true);
});

test('admin config changes the economics live', async () => {
  // A fixed range (min === max) makes the randomised yield deterministic here.
  const { eco } = makeEconomy({
    config: { woolPerShiftMin: 10, woolPerShiftMax: 10, minWithdraw: 1, rateTon: 10 },
  });
  const start = await eco.harvest('7');
  assert.equal(start.pendingWool, 10);

  const cfg = await eco.config();
  assert.equal(cfg.minWithdraw, 1);
  assert.equal(cfg.rateTon, 10);
});

test('referral is idempotent and cannot self-refer', async () => {
  const { eco, store } = makeEconomy();
  await store.putUser(emptyUser('1', 0));

  assert.equal((await eco.registerReferral('1', '1')).ignored, 'self');
  assert.equal((await eco.registerReferral('2', '1')).ok, true);
  assert.equal((await eco.registerReferral('2', '1')).ignored, 'already_referred');
  assert.equal((await eco.user('1')).referrals, 1);
});

test('the user view tolerates a legacy record missing newer fields', () => {
  // Records written before completedTasks/withdrawHistory existed would send
  // undefined and crash the client's renderer.
  const legacy = {
    telegramId: '42',
    wool: 100,
    pendingWool: 0,
    workEndTime: 0,
  };
  const view = Economy.view(legacy, { minWithdraw: 4_500_000, rateTon: 450_000_000 });
  assert.deepEqual(view.completedTasks, []);
  assert.deepEqual(view.withdrawHistory, []);
  assert.equal(view.lastWithdrawTime, 0);
  assert.equal(view.tonWallet, '');
  assert.equal(view.audioEnabled, true);
  assert.equal(view.refEarnedWool, 0);
  assert.equal(view.referrals, 0);
});

test('banned users are blocked everywhere', async () => {
  const { eco, store } = makeEconomy();
  await store.putUser({ ...emptyUser('42', 0), wool: 9_000_000, banned: true });

  assert.equal((await eco.harvest('42')).error, ERR.BANNED);
  assert.equal((await eco.claimTask('42', 't1', alwaysMember)).error, ERR.BANNED);
  assert.equal((await eco.requestWithdraw('42', { wallet: WALLET, amount: 4_500_000 })).error, ERR.BANNED);
});
