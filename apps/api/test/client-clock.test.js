import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastSettlement,
  nextSettlement,
  isWithdrawLocked,
  formatCountdown,
  formatDuration,
} from '../../web/src/clock.js';

const HOUR = 3_600_000;
const at = (iso) => Date.parse(iso);

test('lastSettlement is today 08:00 UTC after the tick', () => {
  assert.equal(lastSettlement(at('2026-10-22T12:00:00Z')), at('2026-10-22T08:00:00Z'));
});

test('lastSettlement is yesterday 08:00 UTC before the tick', () => {
  assert.equal(lastSettlement(at('2026-10-22T06:00:00Z')), at('2026-10-21T08:00:00Z'));
});

test('nextSettlement is always after now', () => {
  for (const iso of ['2026-10-22T06:00:00Z', '2026-10-22T08:00:00Z', '2026-10-22T23:59:00Z']) {
    const now = at(iso);
    assert.ok(nextSettlement(now) > now, `nextSettlement(${iso}) must be in the future`);
  }
});

test('the lock resets exactly at the settlement tick', () => {
  const withdrew = at('2026-10-22T09:00:00Z');
  // Still inside the same window.
  assert.equal(isWithdrawLocked(withdrew, at('2026-10-22T23:00:00Z')), true);
  // Just before the next tick, still locked.
  assert.equal(isWithdrawLocked(withdrew, at('2026-10-23T07:59:00Z')), true);
  // One minute after the tick, unlocked.
  assert.equal(isWithdrawLocked(withdrew, at('2026-10-23T08:01:00Z')), false);
});

test('a player who never withdrew is never locked', () => {
  assert.equal(isWithdrawLocked(0, at('2026-10-22T12:00:00Z')), false);
});

test('REGRESSION: the lock is not shifted by 70 hours', () => {
  // With the original's `252e5` bug the cutoff landed 2d22h away. Anchored to a
  // fixed tick, a withdrawal 3 days ago must unlock on the very next tick.
  const withdrew = at('2026-10-19T09:00:00Z');
  assert.equal(isWithdrawLocked(withdrew, at('2026-10-20T08:00:01Z')), false);
});

test('settlementHourUtc is honoured', () => {
  assert.equal(lastSettlement(at('2026-10-22T12:00:00Z'), 0), at('2026-10-22T00:00:00Z'));
  assert.equal(lastSettlement(at('2026-10-22T12:00:00Z'), 15), at('2026-10-21T15:00:00Z'));
});

test('countdown formatting', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5000), '00:00');
  assert.equal(formatCountdown(90_000), '01:30');
  assert.equal(formatCountdown(180_000), '03:00');
});

test('duration formatting', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3 * HOUR + 61_000), '03:01:01');
});
