import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { AdminService } from '../lib/admin.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';

const BOT = '424242:TEST';
const ADMIN_TOKEN = 'admin-test-token-0123456789';

async function start(opts = {}) {
  const store = new MemoryStore();
  const economy = new Economy({ store, now: () => 1_700_000_000_000 });
  const handler = createApp({
    economy,
    botToken: BOT,
    isMember: async () => true,
    admin: opts.withAdmin === false ? null : new AdminService({ store, economy }),
    adminToken: opts.adminToken ?? ADMIN_TOKEN,
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, store, economy, base: `http://127.0.0.1:${port}` };
}

function call(base, path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('admin: no token is rejected', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await call(base, '/api/admin/config');
  assert.equal(r.status, 401);
  assert.equal(r.body.reason, 'unauthorized');
});

test('admin: a wrong token of the same length is rejected', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  // Same length as the real one: exercises the timing-safe compare, not the
  // early length check.
  const wrong = 'x'.repeat(ADMIN_TOKEN.length);
  const r = await call(base, '/api/admin/config', { token: wrong });
  assert.equal(r.status, 401);
});

test('admin: a token that is a prefix of the real one is rejected', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await call(base, '/api/admin/config', { token: ADMIN_TOKEN.slice(0, -1) });
  assert.equal(r.status, 401);
});

test('admin: no configured token means every request is refused', async (t) => {
  const { server, base } = await start({ adminToken: '' });
  t.after(() => server.close());

  // Even an empty token must not match an empty secret.
  const r = await call(base, '/api/admin/config', { token: '' });
  assert.equal(r.status, 401);
});

test('admin: when the service is absent the route reports it, not a crash', async (t) => {
  const { server, base } = await start({ withAdmin: false });
  t.after(() => server.close());

  const r = await call(base, '/api/admin/config', { token: ADMIN_TOKEN });
  assert.equal(r.status, 503);
  assert.equal(r.body.reason, 'admin_not_configured');
});

test('admin: a valid token can read and write config', async (t) => {
  const { server, base, economy } = await start();
  t.after(() => server.close());

  const read = await call(base, '/api/admin/config', { token: ADMIN_TOKEN });
  assert.equal(read.status, 200);
  assert.equal(read.body.settings.minWithdraw, 4_500_000);

  const write = await call(base, '/api/admin/config', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: { settings: { refPercent: 15 } },
  });
  assert.equal(write.status, 200);
  assert.equal(write.body.settings.refPercent, 15);

  // The write is visible to gameplay, not just to the admin read path.
  assert.equal((await economy.config()).refPercent, 15);
});

test('admin: the token also works as a query parameter', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await fetch(`${base}/api/admin/config?token=${ADMIN_TOKEN}`);
  assert.equal(r.status, 200);
});

test('admin: validation failures return the field and a reason', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await call(base, '/api/admin/config', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: { settings: { rateTon: 0 } },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.reason, 'out_of_range');
  assert.equal(r.body.key, 'rateTon');
});

test('admin: tasks can be replaced over HTTP', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await call(base, '/api/admin/tasks', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: {
      tasks: [
        { id: 'join_channel', channel: '@HoneyBeeFarmChannel', reward: 5000 },
        { id: 'join_chat', channel: 'HoneyBeeFarmChat', reward: 3000 },
      ],
    },
  });

  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.tasks.map((x) => x.id),
    ['join_channel', 'join_chat'],
  );
  assert.equal(r.body.tasks[1].channel, '@HoneyBeeFarmChat');
});

test('admin: unknown admin routes 404 rather than falling through', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const r = await call(base, '/api/admin/whatever', { token: ADMIN_TOKEN });
  assert.equal(r.status, 404);
});
