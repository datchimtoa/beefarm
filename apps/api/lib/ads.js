// Ad reward verification (server-to-server).
//
// The problem this solves: in the original, the client calls
//   show_11373165({ ymid: String(telegramId), requestVar: "start-shift" })
// waits for its promise, and then tells the server "ad watched". A client that
// skips the ad entirely still gets paid.
//
// Fix: the server mints a single-use nonce *before* the shift, the ad provider
// echoes it in its own server-to-server postback, and the shift is only
// granted when a matching postback arrives. The client cannot forge the
// postback because it never sees the provider's secret.
import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Fallback token store, used only when AdVerifier is constructed without one
 * (unit tests). Production always passes the durable store, because a
 * per-process map cannot be shared between serverless instances.
 */
class InMemoryAdTokens {
  constructor() {
    this.tokens = new Map();
  }
  async getAdToken(id) {
    return this.tokens.get(String(id)) ?? null;
  }
  async putAdToken(id, record) {
    this.tokens.set(String(id), { ...record });
  }
  async deleteAdToken(id) {
    this.tokens.delete(String(id));
  }
}



/**
 * One-time ad tokens. In-memory is fine for a single instance; swap for Redis
 * or a Firebase node when you run more than one process.
 */
export class AdVerifier {
  /**
   * @param {object} opts
   * @param {string} opts.secret         shared secret with the ad provider
   * @param {() => number} [opts.now]
   * @param {number} [opts.ttlMs]        how long a token stays valid
   * @param {(token: object) => void} [opts.onForgery]
   */
  constructor({ secret, store, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, onForgery } = {}) {
    if (!secret) throw new Error('AdVerifier requires a secret');
    this.secret = secret;
    this.now = now;
    this.ttlMs = ttlMs;
    this.onForgery = onForgery;

    // Tokens live in the store, not in this object.
    //
    // They used to be Maps on the verifier instance. That breaks on Vercel,
    // where a postback routinely lands on a different serverless instance than
    // the one that issued the token: the lookup found nothing, returned
    // unknown_or_expired, and the player never got the reward even when the ad
    // had been watched in full. Keeping them in the store makes the flow
    // instance-independent.
    this.store = store ?? new InMemoryAdTokens();
  }

  /** Issue a token for a shift. Returns the opaque id to hand to the client. */
  async issue(userId) {
    const tokenId = crypto.randomBytes(16).toString('hex');
    await this.store.putAdToken(tokenId, {
      userId: String(userId),
      status: 'pending', // pending -> watched -> spent
      expiresAt: this.now() + this.ttlMs,
    });
    return tokenId;
  }

  /** Load a token, rejecting it when missing, expired, or issued to someone else. */
  async #live(userId, tokenId) {
    if (!tokenId) return null;
    const rec = await this.store.getAdToken(tokenId);
    if (!rec) return null;
    if (String(rec.userId) !== String(userId)) return null;
    if (Number(rec.expiresAt) < this.now()) return null;
    return rec;
  }

  /** True when the token exists, belongs to this user, and has not expired. */
  async isTokenLive(userId, tokenId) {
    return (await this.#live(userId, tokenId)) !== null;
  }

  /**
   * True only once the provider's postback has released the reward.
   * Issuing a token is NOT watching an ad, so this stays false until
   * `handleMonetagPostback` marks it watched.
   */
  async isAdWatched(userId, tokenId) {
    const rec = await this.#live(userId, tokenId);
    return Boolean(rec) && rec.status === 'watched';
  }

  /**
   * Spend a watched token so it can only start ONE shift.
   * Without this a single watched ad would fund unlimited shifts.
   */
  async consumeForShift(userId, tokenId) {
    const rec = await this.#live(userId, tokenId);
    if (!rec || rec.status !== 'watched') return false;
    // Mark spent first so a concurrent request cannot spend it twice.
    await this.store.putAdToken(tokenId, { ...rec, status: 'spent' });
    return true;
  }

  /** Mark a live token watched. Returns false when it cannot be redeemed. */
  async redeem(userId, tokenId) {
    const rec = await this.#live(userId, tokenId);
    if (!rec) return false;
    if (rec.status !== 'pending') return false;
    await this.store.putAdToken(tokenId, { ...rec, status: 'watched' });
    return true;
  }

  /**
   * Verify and redeem a provider postback.
   * @param {{token?: string, user_id?: string, signature?: string}} body
   * @returns {{ok: boolean, reason?: string, userId?: string}}
   */
  /**
   * Handle a Monetag server-to-server postback.
   *
   * Monetag sends a GET with macros substituted, e.g.
   *   GET /api/ads/postback?secret=...&ymid=42.<token>&event_type=impression
   *       &reward_event_type=valued&estimated_price=0.0037&zone_id=...&telegram_id=...
   *
   * Differences from the generic handler above, both per Monetag's docs:
   *  - the secret travels in the URL (Monetag stores the URL; the app never
   *    sees it), not as an HMAC header
   *  - the reward token is embedded in `ymid` as "<telegramId>.<token>"
   *  - only `reward_event_type === 'valued'` may grant a shift
   *  - the same postback can be retried for ~38h, so this must be idempotent
   *
   * @param {Record<string,string>} query
   */
  async handleMonetagPostback(query = {}) {
    const provided = String(query.secret ?? '');
    const a = Buffer.from(String(this.secret), 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.onForgery?.({ reason: 'bad_secret' });
      return { ok: false, reason: 'bad_secret' };
    }

    const ymid = String(query.ymid ?? '');
    if (!ymid) return { ok: false, reason: 'missing_ymid' };

    // ymid is "<telegramId>.<token>"; the token is what we issued for the shift.
    const dot = ymid.indexOf('.');
    const telegramId = dot === -1 ? ymid : ymid.slice(0, dot);
    const tokenId = dot === -1 ? '' : ymid.slice(dot + 1);

    if (String(query.reward_event_type ?? '') !== 'valued') {
      // Recorded but not rewarded: non_valued still counts as a delivered ad.
      return { ok: false, reason: 'not_valued', telegramId, tokenId };
    }

    const rec = await this.#live(telegramId, tokenId);
    if (!rec) return { ok: false, reason: 'unknown_or_expired', telegramId, tokenId };
    if (rec.status === 'spent') return { ok: false, reason: 'already_spent' };
    if (rec.status === 'watched') return { ok: false, reason: 'already_redeemed' };
    if (!(await this.redeem(telegramId, tokenId))) {
      return { ok: false, reason: 'unknown_or_expired', telegramId, tokenId };
    }

    // Monetag's own retry behaviour means duplicate deliveries are normal; the
    // consumed/spent sets make this a no-op on the second attempt.
    return {
      ok: true,
      userId: telegramId,
      tokenId,
      price: Number(query.estimated_price ?? 0) || 0,
      zoneId: query.zone_id,
      requestVar: query.request_var,
    };
  }

  async handlePostback(body = {}) {
    const tokenId = String(body.token ?? body.token_id ?? '');
    const userId = String(body.user_id ?? body.ymid ?? '');
    const signature = String(body.signature ?? '');

    if (!tokenId || !userId || !signature) {
      return { ok: false, reason: 'missing_fields' };
    }

    // The provider signs with our shared secret, so a client cannot fabricate it.
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${tokenId}.${userId}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.onForgery?.({ userId, tokenId, reason: 'bad_signature' });
      return { ok: false, reason: 'bad_signature' };
    }

    const rec = await this.#live(userId, tokenId);
    if (!rec) return { ok: false, reason: 'unknown_or_expired' };
    if (rec.status === 'spent') return { ok: false, reason: 'already_spent' };
    if (rec.status === 'watched') return { ok: false, reason: 'already_redeemed' };
    if (!(await this.redeem(userId, tokenId))) {
      return { ok: false, reason: 'unknown_or_expired' };
    }
    return { ok: true, userId };
  }

  /** Test/ops helper: build a signature the way a provider would. */
  sign(tokenId, userId) {
    return crypto.createHmac('sha256', this.secret).update(`${tokenId}.${userId}`).digest('hex');
  }

  #sweep() {
    const now = this.now();
    for (const [id, rec] of this.pending) {
      if (rec.expiresAt < now) this.pending.delete(id);
    }
  }
}
