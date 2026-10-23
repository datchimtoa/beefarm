import test from 'node:test';
import assert from 'node:assert/strict';
import { AdVerifier } from '../lib/ads.js';

const SECRET = 'provider-shared-secret';

function make(opts = {}) {
  let clock = 1_700_000_000_000;
  const forgeries = [];
  const v = new AdVerifier({
    secret: SECRET,
    now: () => clock,
    onForgery: (f) => forgeries.push(f),
    ...opts,
  });
  return { v, forgeries, advance: (ms) => (clock += ms) };
}

test('a valid postback redeems a shift token', () => {
  const { v } = make();
  const token = v.issue('42');
  const sig = v.sign(token, '42');

  assert.equal(v.isAdWatched('42', token), false, 'not yet watched before postback');
  const res = v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(res.ok, true);
  assert.equal(res.userId, '42');
  assert.equal(v.isAdWatched('42', token), true);
});

test('THE ATTACK: skipping the ad gets no shift', () => {
  const { v } = make();
  const token = v.issue('42');
  // The client "watches" nothing and asks for the shift directly.
  assert.equal(v.isAdWatched('42', token), false);
});

test('a client cannot forge a postback without the provider secret', () => {
  const { v, forgeries } = make();
  const token = v.issue('42');

  const guesses = [
    '', 'x', 'deadbeef',
    v.sign(token, '42').slice(0, -1) + '0', // one nibble off
    v.sign('other', '42'),                  // signature for a different token
    v.sign(token, '999'),                   // signature for a different user
  ];
  for (const signature of guesses) {
    const res = v.handlePostback({ token, user_id: '42', signature });
    assert.equal(res.ok, false, `accepted forged signature ${JSON.stringify(signature)}`);
  }
  assert.equal(forgeries.length, guesses.length - 1, 'bad signatures are reported');
  assert.equal(v.isAdWatched('42', token), false, 'token still unspent');
});

test('a token cannot be replayed', () => {
  const { v } = make();
  const token = v.issue('42');
  const sig = v.sign(token, '42');

  assert.equal(v.handlePostback({ token, user_id: '42', signature: sig }).ok, true);
  const replay = v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'already_redeemed');
});

test('a token issued to one user cannot pay another', () => {
  const { v } = make();
  const token = v.issue('42');
  const otherUsersSig = v.sign(token, '999');

  const res = v.handlePostback({ token, user_id: '999', signature: otherUsersSig });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_or_expired');
  assert.equal(v.isAdWatched('999', token), false);
});

test('expired tokens are refused', () => {
  const { v, advance } = make({ ttlMs: 1000 });
  const token = v.issue('42');
  const sig = v.sign(token, '42');

  advance(1001);
  assert.equal(v.isAdWatched('42', token), false);
  const res = v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(res.ok, false);
});

test('missing fields are rejected', () => {
  const { v } = make();
  assert.equal(v.handlePostback({}).reason, 'missing_fields');
  assert.equal(v.handlePostback({ token: 'a' }).reason, 'missing_fields');
  assert.equal(v.handlePostback({ token: 'a', user_id: '1' }).reason, 'missing_fields');
});

test('each shift needs its own token', () => {
  const { v } = make();
  const first = v.issue('42');
  v.handlePostback({ token: first, user_id: '42', signature: v.sign(first, '42') });
  assert.equal(v.isAdWatched('42', first), true);

  const second = v.issue('42');
  assert.equal(v.isAdWatched('42', second), false, 'a fresh token starts unredeemed');
});
