import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api, ApiError } from '../../web/src/api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(join(HERE, '..', '..', 'web', 'src', 'main.js'), 'utf8');

/** Install a fetch stub that always answers with the given status/body. */
function stubFetch(status, body) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  return () => {
    globalThis.fetch = original;
  };
}

test('a 402 ad_required surfaces its token on the error', async () => {
  // This is the contract primeAdToken() depends on. The 402 is the EXPECTED
  // answer when an ad is required, and it carries the nonce.
  const restore = stubFetch(402, { success: false, errorCode: 'ad_required', token: 'tok123' });
  try {
    await assert.rejects(
      () => api.harvest(),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'ad_required');
        assert.equal(err.extra.token, 'tok123', 'token must survive on err.extra');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('REGRESSION: primeAdToken must read the token from the 402 error', () => {
  // The bug: api.harvest() throws on non-2xx, so `res.token` was never reached
  // and the nonce was discarded. store.adToken stayed empty, the click bailed
  // out with "ads unavailable", and show_<zone> was never called — which looked
  // exactly like "nothing happens when I press the button".
  const fn = MAIN.slice(MAIN.indexOf('async function primeAdToken'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(
    body.includes('err.code === ' + "'ad_required'"),
    'primeAdToken must special-case ad_required'
  );
  assert.ok(body.includes('err.extra?.token'), 'primeAdToken must read err.extra.token');
  assert.ok(body.includes('store.set({ adToken:'), 'the token must be stored');
});

test('the click handler reads a pre-fetched token, never fetches first', () => {
  // Monetag only opens an ad inside a user gesture; an await before the SDK
  // call spends the gesture and the ad silently fails to open.
  // Scope to the start phase only: the harvest branch is allowed to call the API.
  const startIdx = MAIN.indexOf("// phase === 'start'");
  assert.ok(startIdx > 0, 'start phase block not found');
  const block = MAIN.slice(startIdx, MAIN.indexOf('primeAdToken();', startIdx));
  const beforeAd = block.slice(0, block.indexOf('playAd'));
  assert.ok(beforeAd.length > 0, 'playAd must appear in the start phase');
  assert.ok(
    !/await api\.harvest/.test(beforeAd),
    'no network call may happen before playAd() in the start phase'
  );
  assert.ok(block.includes('store.get().adToken'), 'token must come from state');
});

test('a successful shift clears the spent token', () => {
  assert.ok(
    MAIN.includes("adToken: ''"),
    'the token must be cleared after use so a fresh one is requested'
  );
});
