// Admin operations: configuration editing and moderation.
//
// This is deliberately server-only. The original game had no admin surface at
// all — every setting was edited by hand in the Firebase console, which is how
// the live database drifted out of sync with the code. Mistakes there are
// invisible: `Economy.config()` merges stored values over the defaults, so a
// stale key still "works" and a typo'd key is silently ignored.
//
// Design notes:
//  - Every write is a shallow patch over system_config. Unlisted keys are never
//    touched, so two admins editing different settings cannot clobber each other.
//  - Values are validated against a schema, not trusted. An admin typing
//    "4500000" instead of 4500000 would otherwise be stored as a string and
//    every comparison downstream would quietly fail.

import { DEFAULT_CONFIG } from './economy.js';

/** Thrown for bad admin input; carries a machine-readable reason. */
export class AdminError extends Error {
  constructor(reason, detail = null) {
    super(reason);
    this.name = 'AdminError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Editable numeric settings, with sane bounds.
 *
 * The bounds are not cosmetic: `rateTon` at 0 divides by zero in the withdraw
 * quote, and a negative `minWithdraw` would let anyone withdraw dust.
 */
const NUMERIC = {
  yieldPerRunMin: { min: 0, max: 1_000_000_000 },
  yieldPerRunMax: { min: 0, max: 1_000_000_000 },
  yieldPerRun: { min: 0, max: 1_000_000_000 },
  refPercent: { min: 0, max: 100 },
  minWithdraw: { min: 1, max: 1_000_000_000_000 },
  rateTon: { min: 1, max: 1_000_000_000_000 },
  settlementHourUtc: { min: 0, max: 23 },
  maxWithdrawsPerDay: { min: 0, max: 100 },
};

/** Editable booleans. */
const BOOLEAN = new Set(['taskClaimsEnabled', 'maintenanceMode']);

/** Editable free-text settings, with a hard length cap. */
const TEXT = { announcement: { max: 280 } };

/**
 * Validate one setting. Returns the coerced value or throws AdminError.
 * @param {string} key
 * @param {unknown} value
 */
function coerceSetting(key, value) {
  if (Object.hasOwn(NUMERIC, key)) {
    const rules = NUMERIC[key];
    // Accept a numeric string: admins paste from spreadsheets and the console.
    const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof num !== 'number' || !Number.isFinite(num)) {
      throw new AdminError('not_a_number', { key });
    }
    if (num < rules.min || num > rules.max) {
      throw new AdminError('out_of_range', { key, min: rules.min, max: rules.max });
    }
    return num;
  }

  if (BOOLEAN.has(key)) {
    if (typeof value !== 'boolean') throw new AdminError('not_a_boolean', { key });
    return value;
  }

  if (Object.hasOwn(TEXT, key)) {
    if (typeof value !== 'string') throw new AdminError('not_a_string', { key });
    if (value.length > TEXT[key].max) {
      throw new AdminError('too_long', { key, max: TEXT[key].max });
    }
    return value;
  }

  throw new AdminError('not_editable', { key });
}

/** A Telegram username, with or without the leading @. */
const CHANNEL_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * Validate a task list and normalise it.
 *
 * Ids are the join key with each player's `completedTasks`, so they must be
 * stable and unique. Reusing an id for a different channel would hand out a
 * reward the player never earned.
 * @param {unknown} tasks
 */
export function validateTasks(tasks) {
  if (!Array.isArray(tasks)) throw new AdminError('tasks_not_array');
  if (tasks.length > 20) throw new AdminError('too_many_tasks', { max: 20 });

  const seen = new Set();
  return tasks.map((task, i) => {
    if (!task || typeof task !== 'object') throw new AdminError('bad_task', { index: i });

    const id = String(task.id ?? '').trim();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(id)) {
      throw new AdminError('bad_task_id', { index: i, id });
    }
    if (seen.has(id)) throw new AdminError('duplicate_task_id', { id });
    seen.add(id);

    const channel = String(task.channel ?? '').trim();
    if (!CHANNEL_RE.test(channel)) {
      throw new AdminError('bad_task_channel', { index: i, channel });
    }

    const reward = Number(task.reward);
    if (!Number.isFinite(reward) || reward < 0 || reward > 100_000_000) {
      throw new AdminError('bad_task_reward', { index: i, reward: task.reward });
    }

    // Store the canonical @name so comparisons against Telegram are simple.
    const handle = channel.startsWith('@') ? channel : `@${channel}`;
    return { id, channel: handle, reward: Math.floor(reward) };
  });
}

/**
 * Admin-facing facade. Kept separate from Economy so that gameplay code has no
 * route to configuration writes; only the admin endpoints hold one of these.
 */
export class AdminService {
  /**
   * @param {{store: object, economy: object}} deps
   */
  constructor({ store, economy }) {
    this.store = store;
    this.economy = economy;
  }

  /** Current configuration, merged over defaults, for the settings screen. */
  async getConfig() {
    const stored = (await this.store.getConfig()) ?? {};
    const { tasks, ...settings } = await this.economy.config();

    return {
      // Which keys are stored vs inherited tells the admin what is actually
      // live; a value that only exists as a default is easy to edit by mistake.
      storedKeys: Object.keys(stored),
      settings,
      tasks,
      defaults: { ...DEFAULT_CONFIG },
    };
  }

  /**
   * Apply a settings patch.
   * @param {Record<string, unknown>} patch
   */
  async updateConfig(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new AdminError('patch_not_object');
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'tasks') continue; // handled by setTasks, validated separately
      cleaned[key] = coerceSetting(key, value);
    }

    // Cross-field checks. These cannot live in coerceSetting because they need
    // to see the merged result, not just one value.
    const merged = { ...(await this.economy.config()), ...cleaned };
    if (merged.yieldPerRunMax < merged.yieldPerRunMin) {
      throw new AdminError('yield_range_inverted', {
        min: merged.yieldPerRunMin,
        max: merged.yieldPerRunMax,
      });
    }

    if (Object.keys(cleaned).length > 0) await this.store.putConfig(cleaned);
    return this.getConfig();
  }

  /**
   * Replace the task list.
   * @param {unknown} tasks
   */
  async setTasks(tasks) {
    const validated = validateTasks(tasks);
    await this.store.putConfig({ tasks: validated });
    return this.getConfig();
  }

  /**
   * Credit (or debit) a player manually: the compensation path for a support
   * ticket or a lost ad reward.
   * @param {string} telegramId
   * @param {number} amount  may be negative, but never below zero total
   */
  async grantBalance(telegramId, amount) {
    const id = String(telegramId ?? '').trim();
    if (!/^\d{1,20}$/.test(id)) throw new AdminError('bad_telegram_id');

    const delta = Number(amount);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000_000) {
      throw new AdminError('bad_amount');
    }

    const user = await this.store.getUser(id);
    if (!user) throw new AdminError('unknown_user', { id });

    // Atomic increment, so a concurrent harvest cannot lose this credit.
    // NOTE: the return shape differs between stores — the memory store returns
    // the updated user, Firebase returns the new field value (a number). Read
    // the balance back from the store instead of trusting either.
    await this.store.increment(id, 'balance', delta);
    const after = await this.store.getUser(id);
    const balance = Number(after?.balance ?? 0);

    // A debit that overdraws would leave a negative balance, which the withdraw
    // validation does not expect. Put the overdraft back immediately.
    if (balance < 0) {
      await this.store.increment(id, 'balance', -balance);
      const corrected = await this.store.getUser(id);
      return { telegramId: id, balance: Number(corrected?.balance ?? 0), clamped: true };
    }

    return { telegramId: id, balance, clamped: false };
  }

  /**
   * Ban or unban a player. A ban blocks harvesting, tasks and withdrawals but
   * never deletes the record, so the history stays auditable.
   * @param {string} telegramId
   * @param {boolean} banned
   */
  async setBanned(telegramId, banned) {
    const id = String(telegramId ?? '').trim();
    if (!/^\d{1,20}$/.test(id)) throw new AdminError('bad_telegram_id');
    if (typeof banned !== 'boolean') throw new AdminError('not_a_boolean', { key: 'banned' });

    const user = await this.store.getUser(id);
    if (!user) throw new AdminError('unknown_user', { id });

    await this.store.putUser({ ...user, banned });
    return { telegramId: id, banned };
  }

  /**
   * Withdrawal queue, newest first, for manual settlement.
   * @param {{limit?: number}} [opts]
   */
  async listWithdrawals({ limit = 100 } = {}) {
    const list = await this.store.listWithdrawals?.();
    if (!Array.isArray(list)) return { withdrawals: [], unsupported: true };
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    return {
      withdrawals: list
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, capped),
      unsupported: false,
    };
  }
}
