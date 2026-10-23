import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData, signInitData } from '../lib/telegram.js';

const BOT_TOKEN = '123456:TEST-TOKEN-not-real';
const USER = { id: 42, first_name: 'Phase2', username: 'phase2_bot', language_code: 'en' };

test('accepts a correctly signed initData', () => {
  const initData = signInitData(USER, BOT_TOKEN);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 42);
  assert.equal(result.user.username, 'phase2_bot');
});

test('rejects a tampered user id', () => {
  const initData = signInitData(USER, BOT_TOKEN);
  const params = new URLSearchParams(initData);
  params.set('user', JSON.stringify({ ...USER, id: 999 })); // attacker swaps id
  const result = verifyInitData(params.toString(), BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_signature');
});

test('rejects a signature made with a different bot token', () => {
  const initData = signInitData(USER, '999999:OTHER-TOKEN');
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_signature');
});

test('rejects a tampered auth_date', () => {
  const initData = signInitData(USER, BOT_TOKEN);
  const params = new URLSearchParams(initData);
  params.set('auth_date', '1');
  const result = verifyInitData(params.toString(), BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad_signature');
});

test('rejects expired initData', () => {
  const old = Math.floor(Date.now() / 1000) - 48 * 3600;
  const initData = signInitData(USER, BOT_TOKEN, { authDate: old });
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('rejects missing / empty input', () => {
  assert.equal(verifyInitData('', BOT_TOKEN).reason, 'missing');
  assert.equal(verifyInitData(undefined, BOT_TOKEN).reason, 'missing');
  assert.equal(verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN).reason, 'no_hash');
});

test('rejects when the server has no bot token', () => {
  const initData = signInitData(USER, BOT_TOKEN);
  assert.equal(verifyInitData(initData, '').reason, 'server_misconfigured');
});

test('rejects initData without a user object', () => {
  const initData = signInitData({}, BOT_TOKEN);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_user');
});

test('a hand-built signature matches Telegram\'s documented scheme', async () => {
  // Independent re-derivation inside the test, so a bug in signInitData cannot
  // hide a bug in verifyInitData.
  const crypto = await import('node:crypto');
  const botToken = '5768337691:AAH8L2xqFK4DPQxvT4qS2GSZoP0mFmYwDpQ';
  const fields = {
    auth_date: '1700000000',
    query_id: 'AAHdF6IQAAAAAN0Xoha',
    user: '{"id":279058397,"first_name":"Vladislav"}',
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  const initData = new URLSearchParams({ ...fields, hash }).toString();

  // Verify with a fixed "now" just after auth_date so the freshness check passes.
  const result = verifyInitData(initData, botToken, { now: 1700000060 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.user.id, 279058397);
});
