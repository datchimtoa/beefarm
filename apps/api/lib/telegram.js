// Telegram Mini App initData verification.
//
// Algorithm (Telegram's documented scheme):
//   secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
//   data_check_string = every field except `hash`, sorted "key=value", joined by "\n"
//   expected = HMAC_SHA256(key=secret_key, message=data_check_string)   -> hex
//   valid iff expected === hash
//
// Additionally we enforce `auth_date` freshness so a captured initData cannot
// be replayed indefinitely.
import crypto from 'node:crypto';

const MAX_AGE_SECONDS = 24 * 60 * 60; // 24h, Telegram's own guidance

/**
 * @param {string} initData  raw WebApp.initData string
 * @param {string} botToken  the bot token from BotFather
 * @param {{maxAgeSeconds?: number, now?: number}} [opts]
 * @returns {{ok: true, user: object, authDate: number} | {ok: false, reason: string}}
 */
export function verifyInitData(initData, botToken, opts = {}) {
  const maxAge = opts.maxAgeSeconds ?? MAX_AGE_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (typeof initData !== 'string' || initData.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  if (typeof botToken !== 'string' || botToken.length === 0) {
    return { ok: false, reason: 'server_misconfigured' };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  // Telegram requires lexicographic sort by key; the "key=value" form sorts
  // identically because no key is a prefix of another with a different value.
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare; lengths are equal for hex digests.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: 'no_auth_date' };
  }
  if (now - authDate > maxAge) {
    return { ok: false, reason: 'expired' };
  }
  if (authDate - now > 300) {
    // Clock skew in the future beyond 5 minutes is suspicious.
    return { ok: false, reason: 'future_auth_date' };
  }

  let user = null;
  const rawUser = params.get('user');
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      return { ok: false, reason: 'bad_user_json' };
    }
  }
  if (!user || typeof user.id !== 'number') {
    return { ok: false, reason: 'no_user' };
  }

  // `start_param` carries the deep-link payload (`t.me/bot?startapp=<value>`).
  // It is inside the signed blob, so it cannot be forged: a player cannot claim
  // to have been referred by someone they were not actually referred by.
  const startParam = params.get('start_param') || null;

  return { ok: true, user, authDate, startParam };
}

/**
 * Build a valid initData string. Test-only helper: production never signs.
 * @param {object} user
 * @param {string} botToken
 * @param {{authDate?: number, extra?: Record<string,string>}} [opts]
 */
export function signInitData(user, botToken, opts = {}) {
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(authDate),
    query_id: 'AAH' + authDate,
    user: JSON.stringify(user),
    ...(opts.extra ?? {}),
  };
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}
