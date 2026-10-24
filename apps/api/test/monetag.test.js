import test from 'node:test';
import assert from 'node:assert/strict';
import { AdVerifier } from '../lib/ads.js';

const SECRET = 'monetag-postback-secret';

function make() {
  let clock = 1_700_000_000_000;
  const forgeries = [];
  const v = new AdVerifier({
    secret: SECRET,
    now: () => clock,
    onForgery: (f) => forgeries.push(f),
  });
  return { v, forgeries, advance: (ms) => (clock += ms) };
}

/** Build the query Monetag would send, per its Macro Reference. */
function postback(token, telegramId, overrides = {}) {
  return {
    secret: SECRET,
    ymid: `${telegramId}.${token}`,
    event_type: 'impression',
    reward_event_type: 'valued',
    zone_id: '9876543',
    sub_zone_id: '9876543',
    request_var: 'start-shift',
    telegram_id: String(telegramId),
    estimated_price: '0.0037000',
    ...overrides,
  };
}

test('a valued impression redeems the shift token', async () => {
  const { v } = make();
  const token = await v.issue('42');
  const res = await v.handleMonetagPostback(postback(token, '42'));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.userId, '42');
  assert.equal(res.price, 0.0037);
  assert.equal(await v.isAdWatched('42', token), true);
});

test('THE KEY RULE: a non_valued impression must not grant a shift', async () => {
  // Monetag's docs: a resolved Promise does not mean the event was monetised.
  // Only reward_event_type === 'valued' may pay out.
  const { v } = make();
  const token = await v.issue('42');
  const res = await v.handleMonetagPostback(postback(token, '42', { reward_event_type: 'non_valued' }));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_valued');
  assert.equal(await v.isAdWatched('42', token), false, 'token must stay unspent');
});

test('a wrong secret is rejected', async () => {
  const { v, forgeries } = make();
  const token = await v.issue('42');
  const res = await v.handleMonetagPostback(postback(token, '42', { secret: 'guess' }));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bad_secret');
  assert.equal(forgeries.length, 1);
  assert.equal(await v.isAdWatched('42', token), false);
});

test('a retried postback is idempotent, not a double reward', async () => {
  // Monetag retries failed deliveries for ~38h, so duplicates are expected.
  const { v } = make();
  const token = await v.issue('42');
  assert.equal((await v.handleMonetagPostback(postback(token, '42'))).ok, true);
  const second = await v.handleMonetagPostback(postback(token, '42'));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already_redeemed');
});

test('a ymid for a different user cannot pay this user', async () => {
  const { v } = make();
  const token = await v.issue('42');
  // Attacker takes a token issued to 42 and claims it for 999.
  const res = await v.handleMonetagPostback(postback(token, '999'));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_or_expired');
});

test('a ymid without our token is refused', async () => {
  const { v } = make();
  const res = await v.handleMonetagPostback(postback('', '42', { ymid: '42' }));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_or_expired');
});

test('expired tokens are refused', async () => {
  const { v, advance } = make();
  const token = await v.issue('42');
  advance(6 * 60 * 1000); // past the 5 minute TTL
  const res = await v.handleMonetagPostback(postback(token, '42'));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_or_expired');
});

test('a missing ymid is reported, not crashed on', async () => {
  const { v } = make();
  assert.equal((await v.handleMonetagPostback({ secret: SECRET })).reason, 'missing_ymid');
});

test('estimated_price is optional', async () => {
  const { v } = make();
  const token = await v.issue('42');
  const q = postback(token, '42');
  delete q.estimated_price;
  const res = await v.handleMonetagPostback(q);
  assert.equal(res.ok, true);
  assert.equal(res.price, 0);
});
