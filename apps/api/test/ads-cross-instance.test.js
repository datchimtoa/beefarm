import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';
import { AdVerifier } from '../lib/ads.js';

const BOT = '1:x';
const SECRET = 'shared-secret';
const USER = { id: 42, first_name: 'Multi' };

const post = (base, path, initData, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-init-data': initData },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

/**
 * Build one "serverless instance": its own Economy and AdVerifier objects, but
 * sharing a single durable store, exactly like several Vercel instances sharing
 * one Firebase database.
 */
async function instance(store) {
  const ads = new AdVerifier({ secret: SECRET, store });
  const economy = new Economy({ store, ads });
  const app = createApp({ economy, botToken: BOT, ads, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('THE REWARD BUG: a postback on another instance must still find the token', async (t) => {
  // AdVerifier used to keep tokens in Maps on the instance. On Vercel the
  // postback routinely lands on a different instance, the lookup found nothing,
  // and the player was never paid even after watching the whole ad.
  const store = new MemoryStore();
  const a = await instance(store);
  const b = await instance(store);
  t.after(() => { a.server.close(); b.server.close(); });

  const initData = signInitData(USER, BOT);

  // Instance A issues the token (the player pressed SHEAR).
  const blocked = await post(a.base, '/api/harvest', initData, {});
  assert.equal(blocked.status, 402);
  const token = blocked.body.token;

  // Instance B receives Monetag's postback.
  // Distinct AdVerifier object, same store.
  const verifierB = new AdVerifier({ secret: SECRET, store });
  const result = await verifierB.handleMonetagPostback({
    secret: SECRET,
    ymid: `42.${token}`,
    event_type: 'impression',
    reward_event_type: 'valued',
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  // Instance B can now start the shift with the token.
  const started = await post(b.base, '/api/harvest', initData, { adToken: token });
  assert.equal(started.status, 200);
  assert.equal(started.body.phase, 'shift_started');
});

test('two verifier instances share token state through the store', async () => {
  const store = new MemoryStore();
  const first = new AdVerifier({ secret: SECRET, store });
  const second = new AdVerifier({ secret: SECRET, store });

  const token = await first.issue('42');
  assert.equal(await second.isTokenLive('42', token), true, 'second instance sees the token');

  await second.redeem('42', token);
  assert.equal(await first.isAdWatched('42', token), true, 'first instance sees the watch');
});

test('a token cannot be spent twice even across instances', async () => {
  const store = new MemoryStore();
  const a = new AdVerifier({ secret: SECRET, store });
  const b = new AdVerifier({ secret: SECRET, store });

  const token = await a.issue('42');
  await a.redeem('42', token);

  assert.equal(await a.consumeForShift('42', token), true);
  assert.equal(await b.consumeForShift('42', token), false, 'second spend must fail');
});
