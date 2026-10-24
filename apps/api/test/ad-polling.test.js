import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { MemoryStore } from '../lib/store-memory.js';
import { signInitData } from '../lib/telegram.js';
import { AdVerifier } from '../lib/ads.js';

const BOT = '1:x';
const SECRET = 'poll-secret';
const USER = { id: 42, first_name: 'Poll' };

async function start() {
  const ads = new AdVerifier({ secret: SECRET });
  const economy = new Economy({ store: new MemoryStore(), ads });
  const app = createApp({ economy, botToken: BOT, ads, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const initData = signInitData(USER, BOT);
  return { server, base, initData, ads };
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

test('THE REPORTED BUG: the client must not re-request before the postback lands', async (t) => {
  // The old flow called /api/harvest with the token immediately after the SDK
  // Promise resolved. Monetag confirms server-to-server, so that request raced
  // the postback, returned ad_required, and the button snapped back to
  // WAITING FOR SHEARING ~2s after the click.
  const { server, base, initData } = await start();
  t.after(() => server.close());

  const started = await post(base, '/api/harvest', initData, {});
  assert.equal(started.status, 402);
  const token = started.body.token;

  // Immediate retry, as the old client did:
  const raced = await post(base, '/api/harvest', initData, { adToken: token });
  assert.equal(raced.status, 402, 'still requires the ad');
  assert.equal(raced.body.errorCode, 'ad_required');

  // The polling endpoint tells the client to keep waiting...
  const before = await get(base, `/api/ads/status?token=${token}`, initData);
  assert.equal(before.status, 200);
  assert.equal(before.body.watched, false);
});

test('status flips to watched once the postback arrives, and the shift starts', async (t) => {
  const { server, base, initData, ads } = await start();
  t.after(() => server.close());

  const token = (await post(base, '/api/harvest', initData, {})).body.token;

  ads.handleMonetagPostback({
    secret: SECRET,
    ymid: `42.${token}`,
    event_type: 'impression',
    reward_event_type: 'valued',
  });

  const after = await get(base, `/api/ads/status?token=${token}`, initData);
  assert.equal(after.body.watched, true);

  const shift = await post(base, '/api/harvest', initData, { adToken: token });
  assert.equal(shift.status, 200);
  assert.equal(shift.body.phase, 'shift_started');
});

test('status requires auth and a token', async (t) => {
  const { server, base, initData } = await start();
  t.after(() => server.close());

  const noToken = await get(base, '/api/ads/status', initData);
  assert.equal(noToken.status, 400);
  assert.equal(noToken.body.reason, 'missing_token');

  const noAuth = await fetch(base + '/api/ads/status?token=x');
  assert.equal(noAuth.status, 401);
});

test('one watched token cannot start two shifts', async (t) => {
  const { server, base, initData, ads } = await start();
  t.after(() => server.close());

  const token = (await post(base, '/api/harvest', initData, {})).body.token;
  ads.handleMonetagPostback({
    secret: SECRET,
    ymid: `42.${token}`,
    event_type: 'impression',
    reward_event_type: 'valued',
  });

  assert.equal((await post(base, '/api/harvest', initData, { adToken: token })).status, 200);

  // Shift is running, so a second start is refused by the economy rules.
  const second = await post(base, '/api/harvest', initData, { adToken: token });
  assert.equal(second.status, 409);
  assert.equal(second.body.errorCode, 'not_ready');
});
