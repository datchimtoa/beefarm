// Server-authoritative game economy.
//
// The client is never trusted for: current time, wool owed, shift length,
// withdrawal eligibility, or payout status. Every rule below runs here.
//
// Money-relevant invariants enforced in this module:
//   - a user can run at most one shift at a time            (startShift)
//   - wool is only credited once per completed shift        (harvest)
//   - a task reward is paid at most once                    (claimTask)
//   - at most one withdrawal request per settlement window  (requestWithdraw)
//   - withdrawals are validated against live config         (requestWithdraw)

export const DEFAULT_CONFIG = {
  shiftDurationMs: 3 * 60 * 1000, // "3 mins", as advertised in the UI
  woolPerShift: 182_351,          // matches the figure in the reference screenshots
  refPercent: 10,                 // "Receive 10% of their produced wool"
  minWithdraw: 4_500_000,         // 0.01 GRAM at rateTon
  rateTon: 450_000_000,           // wool per GRAM
  settlementHourUtc: 8,           // daily payout tick (UTC)
  maxWithdrawsPerDay: 1,          // admin-controlled
  tasks: [
    { id: 't1', reward: 5_000, channel: '@LuckySheepFarm_channel' },
    { id: 't2', reward: 5_000, channel: '@LuckySheepFarm_chat' },
    { id: 't3', reward: 5_000, channel: '@HappyCowFarm_channel' },
    { id: 't4', reward: 5_000, channel: '@HappyCowFarm_chat' },
  ],
};

export const ERR = {
  UNAUTHORIZED: 'unauthorized',
  BANNED: 'banned',
  NOT_FOUND: 'not_found',
  NOT_READY: 'not_ready',
  ALREADY_CLAIMED: 'already_claimed',
  NOT_MEMBER: 'not_member',
  INVALID_AMOUNT: 'invalid_amount',
  INVALID_WALLET: 'invalid_wallet',
  INSUFFICIENT_WOOL: 'insufficient_wool',
  MIN_WITHDRAW: 'min_withdraw_error',
  DAILY_LIMIT: 'daily_limit_reached',
  AD_REQUIRED: 'ad_required',
  SYSTEM: 'system_error',
};

const TON_ADDRESS_RE = /^(?:-?\d+:[0-9a-fA-F]{64}|[EU]Q[A-Za-z0-9_-]{46})$/;

export function emptyUser(telegramId, now) {
  return {
    telegramId: String(telegramId),
    wool: 0,
    pendingWool: 0,
    workEndTime: 0,
    refEarnedWool: 0,
    referrals: 0,
    completedTasks: [],
    withdrawHistory: [],
    lastWithdrawTime: 0,
    tonWallet: '',
    language: 'en',
    audioEnabled: true,
    banned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export class Economy {
  /**
   * @param {object} deps
   * @param {{getUser: Function, putUser: Function, getConfig: Function}} deps.store
   * @param {() => number} [deps.now]
   */
  constructor({ store, now = () => Date.now(), ads = null }) {
    this.store = store;
    this.now = now;
    // Optional AdVerifier. When present, starting a shift requires a verified
    // ad; when absent (local dev), shifts start freely and we say so loudly.
    this.ads = ads;
  }

  async config() {
    return { ...DEFAULT_CONFIG, ...(await this.store.getConfig()) };
  }

  async user(telegramId) {
    const existing = await this.store.getUser(String(telegramId));
    return existing ?? emptyUser(telegramId, this.now());
  }

  async #save(user) {
    user.updatedAt = this.now();
    await this.store.putUser(user);
    return user;
  }

  /** Public view of a user; hides internal fields. */
  static view(user, config) {
    return {
      wool: user.wool ?? 0,
      pendingWool: user.pendingWool ?? 0,
      workEndTime: user.workEndTime ?? 0,
      refEarnedWool: user.refEarnedWool ?? 0,
      referrals: user.referrals ?? 0,
      // Records created by an older schema may lack these; always send arrays
      // so the client can render without null guards everywhere.
      completedTasks: Array.isArray(user.completedTasks) ? user.completedTasks : [],
      withdrawHistory: Array.isArray(user.withdrawHistory) ? user.withdrawHistory : [],
      lastWithdrawTime: user.lastWithdrawTime ?? 0,
      tonWallet: user.tonWallet ?? '',
      language: user.language ?? 'en',
      audioEnabled: user.audioEnabled !== false,
      minWithdraw: config.minWithdraw,
      rateTon: config.rateTon,
    };
  }

  /**
   * Start a shift, or harvest one that has finished.
   * One endpoint because the original client uses one button for both states.
   */
  async harvest(telegramId, { adToken } = {}) {
    const config = await this.config();
    const user = await this.user(telegramId);
    if (user.banned) return { error: ERR.BANNED };
    const now = this.now();

    if (user.pendingWool > 0) {
      if (now < user.workEndTime) {
        return { error: ERR.NOT_READY, retryAfterMs: user.workEndTime - now };
      }
      const credited = user.pendingWool;
      user.wool += credited;
      user.pendingWool = 0;
      user.workEndTime = 0;
      await this.#save(user);

      // Pay the referrer a cut of what this referee actually produced.
      const referral = await this.#payReferral(user, credited, config);

      return { ok: true, phase: 'harvest', credited, wool: user.wool, referral };
    }

    // Starting a new shift requires a verified ad. Collecting an already
    // finished shift above is deliberately NOT gated: the player earned it.
    if (this.ads) {
      if (!this.ads.consumeForShift(telegramId, adToken)) {
        // Not watched yet (or already used): hand out a fresh token.
        return { error: ERR.AD_REQUIRED, token: this.ads.issue(telegramId) };
      }
    }

    user.pendingWool = config.woolPerShift;
    user.workEndTime = now + config.shiftDurationMs;
    await this.#save(user);
    return { ok: true, phase: 'shift_started', workEndTime: user.workEndTime, pendingWool: user.pendingWool };
  }

  /**
   * Claim a channel-join task.
   * @param {string} telegramId
   * @param {string} taskId
   * @param {(channel: string) => Promise<boolean>} isMember  membership probe
   */
  async claimTask(telegramId, taskId, isMember) {
    const config = await this.config();
    const user = await this.user(telegramId);
    if (user.banned) return { error: ERR.BANNED };

    const task = config.tasks.find((t) => t.id === taskId);
    if (!task) return { error: ERR.NOT_FOUND };
    if (user.completedTasks.includes(taskId)) return { error: ERR.ALREADY_CLAIMED };

    // The original client trusted a click. We require a real membership check.
    const member = await isMember(task.channel);
    if (!member) return { error: ERR.NOT_MEMBER, channel: task.channel };

    user.completedTasks.push(taskId);
    user.wool += task.reward;
    await this.#save(user);
    return { ok: true, reward: task.reward, wool: user.wool };
  }

  /**
   * Record a referral and pay the referrer a cut of the referee's production.
   * Idempotent per (referrer, referee) pair via `user.referredBy`.
   */
  async registerReferral(telegramId, referrerId) {
    if (!referrerId || String(referrerId) === String(telegramId)) return { ok: false, ignored: 'self' };
    const referee = await this.user(telegramId);
    if (referee.referredBy) return { ok: false, ignored: 'already_referred' };
    const referrer = await this.store.getUser(String(referrerId));
    if (!referrer) return { ok: false, ignored: 'unknown_referrer' };

    referee.referredBy = String(referrerId);
    await this.#save(referee);

    referrer.referrals += 1;
    await this.#save(referrer);
    return { ok: true };
  }

  /**
   * Credit the referrer `refPercent` of the wool the referee just harvested.
   * Returns null when the player has no referrer.
   *
   * Guards:
   *  - self-referral never pays (also blocked at registration)
   *  - a banned or missing referrer is skipped, not an error: the referee's
   *    harvest must succeed regardless
   *  - the amount is floored, so rounding can never mint fractional wool
   */
  async #payReferral(referee, creditedWool, config) {
    const referrerId = referee.referredBy;
    if (!referrerId) return null;
    if (String(referrerId) === String(referee.telegramId)) return null;

    const percent = Number(config.refPercent ?? 0);
    const bonus = Math.floor((creditedWool * percent) / 100);
    if (percent <= 0 || bonus <= 0) return null;

    const referrer = await this.store.getUser(String(referrerId));
    if (!referrer || referrer.banned) return null;

    // Atomic increments, not read-modify-write: two referees can harvest at the
    // same instant, and a lost update here silently underpays the referrer.
    await this.store.increment(referrerId, 'wool', bonus);
    await this.store.increment(referrerId, 'refEarnedWool', bonus);
    return { referrerId: String(referrerId), bonus };
  }

  /** The settlement window a timestamp belongs to, as a UTC date key. */

  async #windowKey(ms) {
    const config = await this.config();
    const d = new Date(ms);
    // Roll back to the most recent settlement tick.
    if (d.getUTCHours() < config.settlementHourUtc) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Validate and record a withdrawal request. Does not move funds. */
  async requestWithdraw(telegramId, { wallet, amount }) {
    const config = await this.config();
    const user = await this.user(telegramId);
    if (user.banned) return { error: ERR.BANNED };

    const address = String(wallet ?? '').trim();
    const value = Number(amount);

    if (!Number.isInteger(value) || value <= 0) return { error: ERR.INVALID_AMOUNT };
    if (!TON_ADDRESS_RE.test(address)) return { error: ERR.INVALID_WALLET };
    if (value < config.minWithdraw) return { error: ERR.MIN_WITHDRAW, min: config.minWithdraw };
    if (value > user.wool) return { error: ERR.INSUFFICIENT_WOOL };

    const now = this.now();
    const window = await this.#windowKey(now);
    const usedToday = user.withdrawHistory.filter((w) => w.window === window).length;
    if (usedToday >= config.maxWithdrawsPerDay) {
      return { error: ERR.DAILY_LIMIT, window, maxPerDay: config.maxWithdrawsPerDay };
    }

    user.wool -= value; // held immediately so the balance cannot be double-spent
    user.lastWithdrawTime = now;
    user.tonWallet = address;
    const entry = {
      id: `w_${now}_${user.withdrawHistory.length}`,
      amount: value,
      gram: Number((value / config.rateTon).toFixed(8)),
      wallet: address,
      timestamp: now,
      window,
      status: 'pending', // pending | processing | paid | rejected
    };
    user.withdrawHistory.push(entry);
    await this.#save(user);
    return { ok: true, withdrawal: entry, wool: user.wool };
  }
}

