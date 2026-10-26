// In-memory store implementing the Economy store contract.
// Used by tests and by the dev server when no Firebase credentials are present.
export class MemoryStore {
  constructor(config = {}) {
    this.users = new Map();
    this.adTokens = new Map();
    this.config = config;
  }

  async getUser(id) {
    const u = this.users.get(String(id));
    return u ? structuredClone(u) : null;
  }

  async putUser(user) {
    this.users.set(String(user.telegramId), structuredClone(user));
  }

  /**
   * Atomically add to a numeric field. Exists because `getUser` returns a copy,
   * so read-modify-write on a shared record loses updates when two harvests
   * run concurrently (verified: 4 concurrent referrals credited once).
   */
  async increment(id, field, delta) {
    const key = String(id);
    const current = this.users.get(key);
    if (!current) return null;
    const next = structuredClone(current);
    next[field] = Number(next[field] ?? 0) + delta;
    next.updatedAt = Date.now();
    this.users.set(key, next);
    return structuredClone(next);
  }


  // -- withdrawals --------------------------------------------------
  // Flattened view of every player's pending requests. Withdrawals live inside
  // each user record (that is how the game writes them), so an operator needs a
  // projection rather than a dedicated collection.

  async listWithdrawals() {
    const out = [];
    for (const [telegramId, user] of this.users) {
      for (const w of user.withdrawHistory ?? []) {
        if (w.status === 'pending') out.push({ ...structuredClone(w), telegramId });
      }
    }
    return out;
  }

  // -- ad tokens ---------------------------------------------------
  // Kept in the store rather than in process memory so that a postback can be
  // handled by a different instance than the one that issued the token. On
  // Vercel two requests routinely land on different serverless instances.

  async getAdToken(tokenId) {
    return this.adTokens.get(String(tokenId)) ?? null;
  }

  async putAdToken(tokenId, record) {
    this.adTokens.set(String(tokenId), { ...record });
  }

  async deleteAdToken(tokenId) {
    this.adTokens.delete(String(tokenId));
  }

  async getConfig() {
    return this.config;
  }

  /** Merge keys into the config, matching FirebaseStore.putConfig. */
  async putConfig(patch) {
    this.config = { ...this.config, ...patch };
  }
}
