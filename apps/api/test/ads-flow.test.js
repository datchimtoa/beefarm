import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';
import { AdVerifier } from '../lib/ads.js';
import { assertPlausibleYield } from './yield-helpers.js';

const BOT = '424242:TEST';
const AD_SECRET = 'ad-shared-secret';
const USER = { id: 42, first_name: 'Ads', username: 'ads_user', language_code: 'en' };

let clock = 1_700_000_000_000;

// Node runs tests within a file sequentially, but this module-level clock is
// shared by every test here. Reset it in each test that advances time so the
// suite cannot depend on execution order.
function resetClock() {
  clock = 1_700_000_000_000;
}

async function startServer({ withAds = true } = {}) {
  const store = new MemoryStore();
  const ads = withAds ? new AdVerifier({ secret: AD_SECRET, now: () => clock }) : null;
  const economy = new Economy({ store, now: () => clock, ads });
  const handler = createApp({ economy, botToken: BOT, isMember: async () => true, ads });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, ads, base: `http://127.0.0.1:${server.address().port}` };
}

function post(base, path, { initData, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (initData) h['x-init-data'] = initData;
  return fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(body ?? {}) }).then(
    async (r) => ({ status: r.status, body: await r.json() })
  );
}

test('a shift is refused until the ad postback arrives (402)', async (t) => {
  resetClock();
  const { server, base } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const first = await post(base, '/api/harvest', { initData });
  assert.equal(first.status, 402);
  assert.equal(first.body.errorCode, 'ad_required');
  assert.ok(first.body.token, 'server must hand out a token to watch against');
});

test('full gated loop: postback -> shift -> harvest', async (t) => {
  resetClock();
  const { server, base, ads } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  // 1. client tries to start; is told to watch an ad and gets a token
  const denied = await post(base, '/api/harvest', { initData });
  const token = denied.body.token;

  // 2. the ad network calls us server-to-server
  const postback = await post(base, '/api/ads/postback', {
    body: { token, user_id: '42', signature: ads.sign(token, '42') },
  });
  assert.equal(postback.status, 200);
  assert.equal(postback.body.success, true);

  // 3. now the shift starts
  const start = await post(base, '/api/harvest', { initData, body: { adToken: token } });
  assert.equal(start.status, 200);
  assert.equal(start.body.phase, 'shift_started');

  // 4. after the shift, harvesting needs no further ad
  clock += 3 * 60 * 1000;
  const done = await post(base, '/api/harvest', { initData });
  assert.equal(done.body.phase, 'harvest');
  assertPlausibleYield(assert, done.body.balance, 'credited balance');
});

test('a forged postback signature is rejected (400)', async (t) => {
  const { server, base, ads } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);
  const token = (await post(base, '/api/harvest', { initData })).body.token;

  const bad = await post(base, '/api/ads/postback', {
    body: { token, user_id: '42', signature: 'not-a-real-signature' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'bad_signature');

  // and the shift still does not start
  const stillBlocked = await post(base, '/api/harvest', { initData, body: { adToken: token } });
  assert.equal(stillBlocked.status, 402);

  // sanity: the real signature for a *different* token must not help
  const other = ads.sign('some-other-token', '42');
  const spoof = await post(base, '/api/ads/postback', { body: { token, user_id: '42', signature: other } });
  assert.equal(spoof.status, 400);
});

test('a postback cannot be replayed to fund a second shift', async (t) => {
  resetClock();
  const { server, base, ads } = await startServer();
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const token = (await post(base, '/api/harvest', { initData })).body.token;
  const sig = ads.sign(token, '42');
  assert.equal((await post(base, '/api/ads/postback', { body: { token, user_id: '42', signature: sig } })).status, 200);

  // replay
  const replay = await post(base, '/api/ads/postback', { body: { token, user_id: '42', signature: sig } });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.reason, 'already_redeemed');

  // one token can only start one shift
  assert.equal((await post(base, '/api/harvest', { initData, body: { adToken: token } })).status, 200);
  clock += 3 * 60 * 1000;
  await post(base, '/api/harvest', { initData }); // harvest it
  const secondTry = await post(base, '/api/harvest', { initData, body: { adToken: token } });
  assert.equal(secondTry.status, 402, 'reused token must not start a second shift');
});

test('without an AdVerifier (dev mode) shifts are unrestricted', async (t) => {
  const { server, base } = await startServer({ withAds: false });
  t.after(() => server.close());
  const initData = signInitData(USER, BOT);

  const r = await post(base, '/api/harvest', { initData });
  assert.equal(r.status, 200);
  assert.equal(r.body.phase, 'shift_started');
});
