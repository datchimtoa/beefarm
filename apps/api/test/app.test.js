import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';
import { assertPlausibleYield, SHIFT_MIN } from './yield-helpers.js';

const BOT = '424242:TEST';
const USER = { id: 42, first_name: 'Mvp', username: 'mvp_user', language_code: 'en' };
const WALLET = 'UQAbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFGHIJ';

let clock = 1_700_000_000_000;

// Reset per test: this clock is shared by every test in the file.
function resetClock() {
  clock = 1_700_000_000_000;
}

async function startServer(opts = {}) {
  const store = new MemoryStore(opts.config ?? {});
  const economy = new Economy({ store, now: () => clock });
  const handler = createApp({
    economy,
    botToken: opts.botToken ?? BOT,
    isMember: opts.isMember ?? (async () => true),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, store, economy, base: `http://127.0.0.1:${port}` };
}

function post(base, path, { initData, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (initData) headers['x-init-data'] = initData;
  return fetch(base + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

function get(base, path, initData) {
  return fetch(base + path, { headers: initData ? { 'x-init-data': initData } : {} }).then(
    async (r) => ({ status: r.status, body: await r.json() })
  );
}

test('no initData -> 401 (client then freezes on its auth modal)', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const r = await post(base, '/api/harvest');
  assert.equal(r.status, 401);
  assert.equal(r.body.errorCode, 'unauthorized');
});

test('forged initData with a swapped user id is rejected', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const good = signInitData(USER, BOT);
  const forged = new URLSearchParams(good);
  forged.set('user', JSON.stringify({ ...USER, id: 999 }));
  const r = await post(base, '/api/harvest', { initData: forged.toString() });
  assert.equal(r.status, 401);
  assert.equal(r.body.errorCode, 'unauthorized');
});

test('full loop: shift -> harvest -> task -> me', async (t) => {
  resetClock();
  const { server, base } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const start = await post(base, '/api/harvest', { initData });
  assert.equal(start.status, 200);
  assert.equal(start.body.phase, 'shift_started');

  clock += 3 * 60 * 1000;

  const done = await post(base, '/api/harvest', { initData });
  assert.equal(done.body.phase, 'harvest');
  assertPlausibleYield(assert, done.body.balance, 'credited balance');

  const task = await post(base, '/api/claim_task', { initData, body: { taskId: 't1' } });
  assert.equal(task.status, 200);
  assert.equal(task.body.balance, done.body.balance + 5000);

  const me = await get(base, '/api/me', initData);
  assert.equal(me.body.me.balance, done.body.balance + 5000, 'harvest + task reward');
  assert.equal(me.body.config.minWithdraw, 4_500_000);
});

test('withdrawal is rejected for a non-member-only flow but works when funded', async (t) => {
  const { server, base, store } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const poor = await post(base, '/api/withdraw', {
    initData,
    body: { wallet: WALLET, amount: 4_500_000 },
  });
  assert.equal(poor.body.errorCode, 'insufficient_balance');

  // Simulate a funded account (in production this comes from real shifts).
  const u = await store.getUser('42');
  await store.putUser({ ...(u ?? { telegramId: '42' }), balance: 5_000_000, completedTasks: [], withdrawHistory: [] });

  const ok = await post(base, '/api/withdraw', { initData, body: { wallet: WALLET, amount: 4_500_000 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balance, 500_000);
});

test('task claim requires membership', async (t) => {
  const { server, base } = await startServer({ isMember: async () => false });
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const r = await post(base, '/api/claim_task', { initData, body: { taskId: 't2' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.errorCode, 'not_member');
});

test('unknown route -> not_found, bad json does not crash', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  assert.equal((await post(base, '/api/nope', { initData })).body.errorCode, 'not_found');

  const raw = await fetch(base + '/api/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-init-data': initData },
    body: 'not json',
  });
  assert.equal(raw.status, 400);
});
