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
  constructor({ secret, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, onForgery } = {}) {
    if (!secret) throw new Error('AdVerifier requires a secret');
    this.secret = secret;
    this.now = now;
    this.ttlMs = ttlMs;
    this.onForgery = onForgery;
    this.pending = new Map(); // tokenId -> { userId, expiresAt }
    this.consumed = new Set(); // tokenIds already redeemed
    this.watchedBy = new Map(); // tokenId -> userId that redeemed it
    this.spent = new Set(); // tokenIds already used to start a shift
  }

  /** Issue a token for a shift. Returns the opaque id to hand to the client. */
  issue(userId) {
    const tokenId = crypto.randomBytes(16).toString('hex');
    this.pending.set(tokenId, { userId: String(userId), expiresAt: this.now() + this.ttlMs });
    this.#sweep();
    return tokenId;
  }

  /** True when the user has a valid, unexpired, unredeemed token. */
  isTokenLive(userId, tokenId) {
    const rec = this.pending.get(tokenId);
    if (!rec) return false;
    if (rec.userId !== String(userId)) return false;
    if (rec.expiresAt < this.now()) return false;
    return true;
  }

  /**
   * True only once the provider's postback has redeemed the token.
   * Issuing a token is NOT watching an ad — this is the check that gates a
   * shift, so it must stay false until `handlePostback` succeeds.
   */
  isAdWatched(userId, tokenId) {
    return this.consumed.has(tokenId) && this.watchedBy.get(tokenId) === String(userId);
  }

  /**
   * Spend a redeemed token so it can only start ONE shift.
   * Without this, a single watched ad would fund unlimited shifts.
   */
  consumeForShift(userId, tokenId) {
    if (!this.isAdWatched(userId, tokenId)) return false;
    this.watchedBy.delete(tokenId);
    this.consumed.delete(tokenId);
    this.spent.add(tokenId);
    return true;
  }

  /** Consume a token. Idempotent-safe: a token can only be redeemed once. */
  redeem(userId, tokenId) {
    if (!this.isTokenLive(userId, tokenId)) return false;
    this.pending.delete(tokenId);
    this.consumed.add(tokenId);
    this.watchedBy.set(tokenId, String(userId));
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
  handleMonetagPostback(query = {}) {
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

    if (this.spent.has(tokenId)) return { ok: false, reason: 'already_spent' };
    if (this.consumed.has(tokenId)) return { ok: false, reason: 'already_redeemed' };
    if (!this.isTokenLive(telegramId, tokenId)) {
      return { ok: false, reason: 'unknown_or_expired', telegramId, tokenId };
    }
    if (!this.redeem(telegramId, tokenId)) {
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

  handlePostback(body = {}) {
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

    if (this.spent.has(tokenId)) {
      return { ok: false, reason: 'already_spent' };
    }
    if (this.consumed.has(tokenId)) {
      return { ok: false, reason: 'already_redeemed' };
    }
    if (!this.isTokenLive(userId, tokenId)) {
      return { ok: false, reason: 'unknown_or_expired' };
    }
    if (!this.redeem(userId, tokenId)) {
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
