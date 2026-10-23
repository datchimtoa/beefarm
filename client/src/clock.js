// Time helpers.
//
// IMPORTANT: this deliberately does NOT copy the original's `U()`.
// The original did `new Date(t + 252e5)` intending a UTC+7 shift, but 252e5 ms
// is 70 hours, not 7 (a UTC+7 shift is 252e7). That pushed the "daily" cutoff
// 2d22h into the future, so the withdraw lock fired at 10:00 UTC instead of the
// advertised time.
//
// Here the settlement window is computed in UTC on the server's terms, and the
// client only displays it.

const HOUR_MS = 3_600_000;

/** The settlement instant for a given moment: most recent `hour` UTC tick. */
export function lastSettlement(nowMs, settlementHourUtc = 8) {
  const d = new Date(nowMs);
  d.setUTCHours(settlementHourUtc, 0, 0, 0);
  if (d.getTime() > nowMs) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

/** Next settlement instant strictly after now. */
export function nextSettlement(nowMs, settlementHourUtc = 8) {
  return lastSettlement(nowMs, settlementHourUtc) + 24 * HOUR_MS;
}

/**
 * True when the player has already withdrawn in the current settlement window.
 * Mirrors the server rule so the UI can disable the button early, but the
 * server remains the authority.
 */
export function isWithdrawLocked(lastWithdrawTime, nowMs, settlementHourUtc = 8) {
  if (!lastWithdrawTime) return false;
  return Number(lastWithdrawTime) >= lastSettlement(nowMs, settlementHourUtc);
}

/** mm:ss for a remaining duration, clamped at 00:00. */
export function formatCountdown(remainingMs) {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** hh:mm:ss, matching the original's payout countdown. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
