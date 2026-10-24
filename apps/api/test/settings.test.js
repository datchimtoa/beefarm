import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';

const BOT = '1:x';
const USER = { id: 42, first_name: 'Settings' };

async function start() {
  const store = new MemoryStore();
  const economy = new Economy({ store });
  const app = createApp({ economy, botToken: BOT, ads: null, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, store, initData: signInitData(USER, BOT) };
}

const post = (base, path, initData, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-init-data': initData },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const get = (base, path, initData) =>
  fetch(base + path, { headers: { 'x-init-data': initData } }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

test('language preference is saved and returned by /api/me', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  const saved = await post(base, '/api/settings', initData, { language: 'vi' });
  assert.equal(saved.status, 200);

  const me = await get(base, '/api/me', initData);
  assert.equal(me.body.me.language, 'vi');
});

test('audio preference is saved', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  await post(base, '/api/settings', initData, { audioEnabled: false });
  const me = await get(base, '/api/me', initData);
  assert.equal(me.body.me.audioEnabled, false);

  await post(base, '/api/settings', initData, { audioEnabled: true });
  assert.equal((await get(base, '/api/me', initData)).body.me.audioEnabled, true);
});

test('both preferences can be set in one call', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  await post(base, '/api/settings', initData, { language: 'ru', audioEnabled: false });
  const me = (await get(base, '/api/me', initData)).body.me;
  assert.equal(me.language, 'ru');
  assert.equal(me.audioEnabled, false);
});

test('an empty settings body is rejected, not silently ignored', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  const res = await post(base, '/api/settings', initData, {});
  assert.equal(res.status, 400);
});

test('settings require authentication', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const res = await fetch(base + '/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'vi' }),
  });
  assert.equal(res.status, 401);
});

test('an over-long language code is truncated rather than stored blindly', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  await post(base, '/api/settings', initData, { language: 'x'.repeat(100) });
  const me = (await get(base, '/api/me', initData)).body.me;
  assert.ok(me.language.length <= 12, `stored ${me.language.length} chars`);
});
