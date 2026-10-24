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

/**
 * Flip the last hex nibble of a signature so it is guaranteed to differ.
 *
 * The obvious `slice(0, -1) + '0'` is wrong: when the real signature already
 * ends in '0' (~1/16 of the time) the "forgery" is byte-identical to the valid
 * one and the test fails intermittently for no real reason.
 */
function tamperedSignature(sig) {
  const last = sig.slice(-1);
  const flipped = last === '0' ? '1' : '0';
  return sig.slice(0, -1) + flipped;
}

test('a valid postback redeems a shift token', async () => {
  const { v } = make();
  const token = await v.issue('42');
  const sig = v.sign(token, '42');

  assert.equal(await v.isAdWatched('42', token), false, 'not yet watched before postback');
  const res = await v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(res.ok, true);
  assert.equal(res.userId, '42');
  assert.equal(await v.isAdWatched('42', token), true);
});

test('THE ATTACK: skipping the ad gets no shift', async () => {
  const { v } = make();
  const token = await v.issue('42');
  // The client "watches" nothing and asks for the shift directly.
  assert.equal(await v.isAdWatched('42', token), false);
});

test('a client cannot forge a postback without the provider secret', async () => {
  const { v, forgeries } = make();
  const token = await v.issue('42');

  const guesses = [
    '', 'x', 'deadbeef',
    tamperedSignature(v.sign(token, '42')), // one nibble off, always different
    v.sign('other', '42'),                  // signature for a different token
    v.sign(token, '999'),                   // signature for a different user
  ];
  for (const signature of guesses) {
    const res = await v.handlePostback({ token, user_id: '42', signature });
    assert.equal(res.ok, false, `accepted forged signature ${JSON.stringify(signature)}`);
  }
  assert.equal(forgeries.length, guesses.length - 1, 'bad signatures are reported');
  assert.equal(await v.isAdWatched('42', token), false, 'token still unspent');
});

test('a token cannot be replayed', async () => {
  const { v } = make();
  const token = await v.issue('42');
  const sig = v.sign(token, '42');

  assert.equal((await v.handlePostback({ token, user_id: '42', signature: sig })).ok, true);
  const replay = await v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'already_redeemed');
});

test('a token issued to one user cannot pay another', async () => {
  const { v } = make();
  const token = await v.issue('42');
  const otherUsersSig = v.sign(token, '999');

  const res = await v.handlePostback({ token, user_id: '999', signature: otherUsersSig });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_or_expired');
  assert.equal(await v.isAdWatched('999', token), false);
});

test('expired tokens are refused', async () => {
  const { v, advance } = make({ ttlMs: 1000 });
  const token = await v.issue('42');
  const sig = v.sign(token, '42');

  advance(1001);
  assert.equal(await v.isAdWatched('42', token), false);
  const res = await v.handlePostback({ token, user_id: '42', signature: sig });
  assert.equal(res.ok, false);
});

test('missing fields are rejected', async () => {
  const { v } = make();
  assert.equal((await v.handlePostback({})).reason, 'missing_fields');
  assert.equal((await v.handlePostback({ token: 'a' })).reason, 'missing_fields');
  assert.equal((await v.handlePostback({ token: 'a', user_id: '1' })).reason, 'missing_fields');
});

test('each shift needs its own token', async () => {
  const { v } = make();
  const first = await v.issue('42');
  await v.handlePostback({ token: first, user_id: '42', signature: v.sign(first, '42') });
  assert.equal(await v.isAdWatched('42', first), true);

  const second = await v.issue('42');
  assert.equal(await v.isAdWatched('42', second), false, 'a fresh token starts unredeemed');
});
