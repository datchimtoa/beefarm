// Game state. Field names mirror the original bundle so the existing HTML
// markup, data-key hooks and CSS keep working unchanged.
//
// Unlike the original, this is a plain store with subscribers: the UI re-renders
// from state rather than each handler poking the DOM.

export const DEFAULTS = {
  balance: 0,
  pendingYield: 0,
  runEndTime: 0,
  refEarned: 0,
  referrals: 0,
  completedTasks: [],
  withdrawHistory: [],
  lastWithdrawTime: 0,
  tonWallet: '',
  language: 'en',
  audioEnabled: true,
  minWithdraw: 4_500_000,
  rateTon: 450_000_000,
  // Pre-fetched ad nonce. Kept in state because Monetag must be called
  // inside the click's user gesture, so no network call can happen first.
  adToken: '',
};

export function createStore(initial = {}) {
  let state = { ...DEFAULTS, ...initial };
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) fn(state);
  }

  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      emit();
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },
  };
}

/** Format balance the way the original did: Intl grouping, no decimals. */
export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.floor(Number(value) || 0));
}

/** balance -> GRAM string, matching the original's 2dp display. */
export function toGram(balance, rateTon) {
  if (!rateTon) return '0.00';
  return (Number(balance || 0) / Number(rateTon)).toFixed(2);
}
