
/**
 * Assert an amount is a plausible shift yield.
 *
 * The yield is randomised per shift (so the game does not look machine-made), so
 * tests must check the range and the variance rather than an exact constant.
 */
export const SHIFT_MIN = 165_000;
export const SHIFT_MAX = 198_000;
export function assertPlausibleYield(assert, amount, label = 'yield') {
  assert.ok(
    amount >= SHIFT_MIN && amount <= SHIFT_MAX,
    `${label} ${amount} outside ${SHIFT_MIN}-${SHIFT_MAX}`
  );
  assert.equal(amount % 100, 0, `${label} ${amount} not a multiple of 100`);
}
