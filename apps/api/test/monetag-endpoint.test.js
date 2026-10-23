import test from 'node:test';
import assert from 'node:assert/strict';

test('a postback to an unconfigured deployment says so, not 401', async (t) => {
  // Previously this fell through to the initData gate and returned
  // "401 unauthorized", which looks like a Telegram auth failure and sends you
  // hunting in the wrong place. A missing AD_POSTBACK_SECRET must be explicit.
  const http = await import('node:http');
  const { createApp } = await import('../app.js');
  const { Economy } = await import('../lib/economy.js');
  const { MemoryStore } = await import('../lib/store-memory.js');

  const economy = new Economy({ store: new MemoryStore() });
  const app = createApp({ economy, botToken: '1:x', ads: null, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(
    `${base}/api/ads/postback?ymid=42.x&event_type=impression&reward_event_type=valued`
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.reason, 'ad_verification_not_configured');
});

test('a monetag postback with a bad secret is rejected as bad_secret', async (t) => {
  const http = await import('node:http');
  const { createApp } = await import('../app.js');
  const { Economy } = await import('../lib/economy.js');
  const { MemoryStore } = await import('../lib/store-memory.js');
  const { AdVerifier } = await import('../lib/ads.js');

  const ads = new AdVerifier({ secret: 'right-secret' });
  const economy = new Economy({ store: new MemoryStore(), ads });
  const app = createApp({ economy, botToken: '1:x', ads, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(
    `${base}/api/ads/postback?secret=wrong&ymid=42.x&event_type=impression&reward_event_type=valued`
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).reason, 'bad_secret');
});

test('a non_valued postback answers 200 so Monetag stops retrying', async (t) => {
  const http = await import('node:http');
  const { createApp } = await import('../app.js');
  const { Economy } = await import('../lib/economy.js');
  const { MemoryStore } = await import('../lib/store-memory.js');
  const { AdVerifier } = await import('../lib/ads.js');

  const ads = new AdVerifier({ secret: 's' });
  const token = ads.issue('42');
  const economy = new Economy({ store: new MemoryStore(), ads });
  const app = createApp({ economy, botToken: '1:x', ads, isMember: async () => true });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(
    `${base}/api/ads/postback?secret=s&ymid=42.${token}` +
      '&event_type=impression&reward_event_type=non_valued'
  );
  // 2xx stops the ~38h retry loop; the reward is simply not granted.
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reason, 'not_valued');
  assert.equal(ads.isAdWatched('42', token), false);
});
