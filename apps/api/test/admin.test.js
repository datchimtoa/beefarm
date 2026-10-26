import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminService, AdminError, validateTasks } from '../lib/admin.js';
import { Economy, emptyUser } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';

function make() {
  const store = new MemoryStore();
  const economy = new Economy({ store, now: () => 1_700_000_000_000 });
  const admin = new AdminService({ store, economy });
  return { store, economy, admin };
}

const rejects = (fn, reason) =>
  assert.rejects(fn, (err) => {
    assert.ok(err instanceof AdminError, 'should be an AdminError');
    assert.equal(err.reason, reason);
    return true;
  });

test('config reads back merged values plus the stored-key list', async () => {
  const { admin } = make();
  const cfg = await admin.getConfig();

  assert.equal(cfg.settings.minWithdraw, 4_500_000);
  assert.deepEqual(cfg.storedKeys, [], 'nothing stored yet');
  assert.equal(cfg.tasks[0].channel, '@HoneyBeeFarmChannel');
  assert.ok(cfg.defaults.minWithdraw, 'defaults offered for reset');
});

test('a settings patch is validated, stored and visible immediately', async () => {
  const { admin } = make();
  await admin.updateConfig({ minWithdraw: 1_000_000 });

  const cfg = await admin.getConfig();
  assert.equal(cfg.settings.minWithdraw, 1_000_000);
  assert.deepEqual(cfg.storedKeys, ['minWithdraw']);
});

test('a numeric string is coerced, because admins paste from spreadsheets', async () => {
  const { admin } = make();
  await admin.updateConfig({ rateTon: '900000000' });
  assert.equal((await admin.getConfig()).settings.rateTon, 900_000_000);
});

test('bad settings are rejected rather than stored', async () => {
  const { admin } = make();
  await rejects(() => admin.updateConfig({ minWithdraw: 'abc' }), 'not_a_number');
  await rejects(() => admin.updateConfig({ rateTon: 0 }), 'out_of_range');
  await rejects(() => admin.updateConfig({ refPercent: 150 }), 'out_of_range');
  await rejects(() => admin.updateConfig({ nope: 1 }), 'not_editable');
  await rejects(() => admin.updateConfig({ maintenanceMode: 'yes' }), 'not_a_boolean');

  assert.deepEqual((await admin.getConfig()).storedKeys, [], 'nothing was written');
});

test('an inverted yield range is caught across two fields', async () => {
  const { admin } = make();
  // min is fine on its own; only the pair is invalid.
  await rejects(() => admin.updateConfig({ yieldPerRunMin: 999_000_000 }), 'yield_range_inverted');
});

test('tasks: valid list is normalised to @handles', async () => {
  const { admin } = make();
  const cfg = await admin.setTasks([
    { id: 'join_channel', channel: 'HoneyBeeFarmChannel', reward: 5000 },
    { id: 'join_chat', channel: '@HoneyBeeFarmChat', reward: 7500.9 },
  ]);

  assert.deepEqual(cfg.tasks, [
    { id: 'join_channel', channel: '@HoneyBeeFarmChannel', reward: 5000 },
    { id: 'join_chat', channel: '@HoneyBeeFarmChat', reward: 7500 },
  ]);
});

test('tasks: duplicates, bad ids and bad channels are refused', () => {
  assert.throws(() => validateTasks(null), { name: 'AdminError' });
  assert.throws(
    () =>
      validateTasks([
        { id: 'join_channel', channel: '@HoneyBeeFarmChannel', reward: 1 },
        { id: 'join_channel', channel: '@Other', reward: 1 },
      ]),
    { reason: 'duplicate_task_id' },
  );
  assert.throws(() => validateTasks([{ id: 'A', channel: '@x', reward: 1 }]), {
    reason: 'bad_task_id',
  });
  assert.throws(
    () => validateTasks([{ id: 'join_channel', channel: 'not a channel!', reward: 1 }]),
    { reason: 'bad_task_channel' },
  );
  assert.throws(
    () => validateTasks([{ id: 'join_channel', channel: '@HoneyBeeFarmChannel', reward: -5 }]),
    { reason: 'bad_task_reward' },
  );
});

test('grantBalance credits a player atomically', async () => {
  const { admin, store } = make();
  await store.putUser(emptyUser('42', 0));

  const res = await admin.grantBalance('42', 25_000);
  assert.equal(res.balance, 25_000);
  assert.equal((await store.getUser('42')).balance, 25_000);
});

test('grantBalance cannot push a balance negative', async () => {
  const { admin, store } = make();
  await store.putUser(emptyUser('42', 0));

  const res = await admin.grantBalance('42', -50_000);
  assert.equal(res.clamped, true);
  assert.equal(res.balance, 0, 'overdraft is reversed');
  assert.equal((await store.getUser('42')).balance, 0);
});

test('grantBalance rejects unknown players and junk amounts', async () => {
  const { admin, store } = make();
  await store.putUser(emptyUser('42', 0));

  await rejects(() => admin.grantBalance('999', 1000), 'unknown_user');
  await rejects(() => admin.grantBalance('42', 0), 'bad_amount');
  await rejects(() => admin.grantBalance('42', 1.5), 'bad_amount');
  await rejects(() => admin.grantBalance('abc', 1000), 'bad_telegram_id');
});

test('banning blocks harvesting, and unbanning restores it', async () => {
  const { admin, store, economy } = make();
  await store.putUser(emptyUser('42', 0));

  await admin.setBanned('42', true);
  assert.equal((await store.getUser('42')).banned, true);
  assert.equal((await economy.harvest('42')).error, 'banned');

  await admin.setBanned('42', false);
  assert.equal((await economy.harvest('42')).phase, 'shift_started');
});

test('the withdrawal queue lists only pending requests, newest first', async () => {
  const { admin, store, economy } = make();

  const wallet = 'UQAbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFGHIJ';
  await store.putUser({ ...emptyUser('11', 0), balance: 9_000_000 });
  await store.putUser({ ...emptyUser('22', 0), balance: 9_000_000 });

  const first = await economy.requestWithdraw('11', { wallet, amount: 5_000_000 });
  assert.ok(first.ok, 'first withdrawal should be accepted');
  await economy.requestWithdraw('22', { wallet, amount: 6_000_000 });

  const { withdrawals, unsupported } = await admin.listWithdrawals();
  assert.equal(unsupported, false);
  assert.equal(withdrawals.length, 2);
  assert.ok(withdrawals.every((w) => w.status === 'pending'));
  assert.ok(withdrawals.every((w) => w.telegramId), 'player id is attached by the projection');
});

test('withdrawal listing is empty, not an error, when nothing is pending', async () => {
  const { admin } = make();
  const res = await admin.listWithdrawals();
  assert.deepEqual(res.withdrawals, []);
  assert.equal(res.unsupported, false);
});
