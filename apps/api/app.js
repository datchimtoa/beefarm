// HTTP app for the Mini App MVP. Framework-free so it runs on Node's http
// module locally and can be ported to a Vercel function with one wrapper.
//
// Auth: every /api call must carry `x-init-data`; we verify the Telegram HMAC
// and derive the user id from the *verified* payload. The client never tells us
// who it is.
import crypto from 'node:crypto';
import { verifyInitData } from './lib/telegram.js';
import { Economy, ERR } from './lib/economy.js';

const STATUS = {
  [ERR.UNAUTHORIZED]: 401,
  [ERR.BANNED]: 403,
  [ERR.NOT_FOUND]: 404,
  [ERR.NOT_READY]: 409,
  [ERR.ALREADY_CLAIMED]: 409,
  [ERR.NOT_MEMBER]: 403,
  [ERR.DAILY_LIMIT]: 429,
  [ERR.SYSTEM]: 500,
  [ERR.INVALID_AMOUNT]: 400,
  [ERR.INVALID_WALLET]: 400,
  [ERR.INSUFFICIENT_BALANCE]: 400,
  [ERR.MIN_WITHDRAW]: 400,
  [ERR.AD_REQUIRED]: 402,
};
/**
 * Constant-time string comparison.
 *
 * Comparing admin tokens with `===` leaks the length and prefix through timing.
 * Over the public internet that is not a practical attack, but the fix is three
 * lines and this is the one credential in the system that can rewrite payouts.
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Admin API. Authenticated with a shared secret, not Telegram initData: the
 * operator is an admin, not a player, and may not even be using the Mini App.
 *
 * @param {{req: object, res: object, route: string, url: URL, admin: object|null, adminToken: string}} ctx
 */
async function handleAdmin({ req, res, route, url, admin, adminToken }) {
  // Refuse everything when admin is not configured, rather than defaulting open.
  if (!admin) return json(res, 503, { success: false, reason: 'admin_not_configured' });

  const supplied = req.headers['x-admin-token'] ?? url.searchParams.get('token') ?? '';
  if (!adminToken || !safeEqual(supplied, adminToken)) {
    return json(res, 401, { success: false, reason: 'unauthorized' });
  }

  try {
    if (req.method === 'GET' && route === '/api/admin/config') {
      return json(res, 200, { success: true, ...(await admin.getConfig()) });
    }

    if (req.method === 'POST' && route === '/api/admin/config') {
      const body = await readBody(req);
      const result = await admin.updateConfig(body.settings ?? body);
      return json(res, 200, { success: true, ...result });
    }

    if (req.method === 'POST' && route === '/api/admin/tasks') {
      const body = await readBody(req);
      const result = await admin.setTasks(body.tasks ?? []);
      return json(res, 200, { success: true, ...result });
    }

    if (req.method === 'POST' && route === '/api/admin/grant') {
      const { telegramId, amount } = await readBody(req);
      return json(res, 200, { success: true, ...(await admin.grantBalance(telegramId, amount)) });
    }

    if (req.method === 'POST' && route === '/api/admin/ban') {
      const { telegramId, banned } = await readBody(req);
      return json(res, 200, { success: true, ...(await admin.setBanned(telegramId, banned)) });
    }

    if (req.method === 'GET' && route === '/api/admin/withdrawals') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return json(res, 200, { success: true, ...(await admin.listWithdrawals({ limit })) });
    }

    return json(res, 404, { success: false, reason: 'unknown_admin_route' });
  } catch (err) {
    // Validation failures are the operator's fault: report them precisely so the
    // panel can highlight the offending field.
    if (err?.name === 'AdminError') {
      return json(res, 400, { success: false, reason: err.reason, ...(err.detail ?? {}) });
    }
    console.error('[admin] unexpected:', err);
    return json(res, 500, { success: false, reason: 'internal_error' });
  }
}



function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-init-data',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function failure(res, error, extra = {}) {
  // The original client does `k("api_" + errorCode)`, so `error` must be one of
  // the codes it already has strings for.
  return json(res, STATUS[error] ?? 400, { success: false, errorCode: error, ...extra });
}

async function readBody(req, limit = 8 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {object} deps
 * @param {import('./lib/economy.js').Economy} deps.economy
 * @param {string} deps.botToken
 * @param {(channel: string, userId: string) => Promise<boolean>} deps.isMember
 */
export function createApp({ economy, botToken, isMember, ads = null, admin = null, adminToken = '' }) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,x-init-data',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }

    if (route === '/api/health') {
      return json(res, 200, { success: true, ok: true, ts: Date.now() });
    }

    // Ad provider server-to-server postback. Deliberately NOT behind
    // verifyInitData: the caller is the ad network, authenticated by an HMAC
    // over (token, user_id) using the shared secret instead.
    // Monetag posts back as a GET with macros substituted in the query string.
    // It retries for ~38h, so a non-2xx here means repeated deliveries.
    if (route === '/api/ads/postback') {
      // Answer here even when ads are unconfigured. Falling through would hit
      // the initData gate below and return a misleading 401 unauthorized,
      // making a missing AD_POSTBACK_SECRET look like a Telegram auth failure.
      if (!ads) {
        console.error('[ads] postback received but AD_POSTBACK_SECRET is not set');
        return json(res, 503, {
          success: false,
          reason: 'ad_verification_not_configured',
        });
      }
      const params = Object.fromEntries(url.searchParams.entries());

      // Monetag's macros arrive as query params; our own test harness posts JSON.
      const isMonetag = 'ymid' in params && 'reward_event_type' in params;
      if (isMonetag) {
        const result = await ads.handleMonetagPostback(params);
        if (!result.ok) {
          // A non_valued impression is expected and not a failure worth 500ing:
          // answer 200 so Monetag stops retrying, but grant nothing.
          const benign = ['not_valued', 'already_redeemed', 'already_spent', 'unknown_or_expired'];
          console.warn('[ads] monetag postback', { reason: result.reason });
          return json(res, benign.includes(result.reason) ? 200 : 400, {
            success: false,
            reason: result.reason,
          });
        }
        console.info('[ads] monetag reward confirmed', {
          userId: result.userId,
          price: result.price,
          requestVar: result.requestVar,
        });
        return json(res, 200, { success: true });
      }

      const body = await readBody(req);
      const result = await ads.handlePostback(body);
      if (!result.ok) {
        console.warn('[ads] rejected postback', { reason: result.reason });
        return json(res, 400, { success: false, reason: result.reason });
      }
      return json(res, 200, { success: true });
    }

    if (!route.startsWith('/api/')) {
      return json(res, 404, { success: false, errorCode: ERR.NOT_FOUND });
    }

    // Admin routes authenticate with their own shared secret, so they must be
    // handled BEFORE the player initData gate below. Leaving them after it meant
    // every admin call also needed a valid Telegram player session.
    if (route.startsWith('/api/admin/')) {
      return handleAdmin({ req, res, route, url, admin, adminToken });
    }

    const auth = verifyInitData(req.headers['x-init-data'], botToken);
    if (!auth.ok) {
      // 401 intentionally: the client treats it as a hard auth failure.
      return failure(res, ERR.UNAUTHORIZED, { reason: auth.reason });
    }
    const userId = String(auth.user.id);

    try {
      if (req.method === 'POST' && route === '/api/harvest') {
        const body = await readBody(req);
        const result = await economy.harvest(userId, { adToken: body.adToken });
        if (result.error) {
          return failure(res, result.error, { retryAfterMs: result.retryAfterMs, token: result.token });
        }
        return json(res, 200, { success: true, ...result });
      }

      if (req.method === 'POST' && route === '/api/claim_task') {
        const body = await readBody(req);
        const taskId = String(body.taskId ?? '');
        const result = await economy.claimTask(userId, taskId, () => isMember(taskId, userId));
        if (result.error) return failure(res, result.error, { channel: result.channel });
        return json(res, 200, { success: true, ...result });
      }

      if (req.method === 'POST' && route === '/api/withdraw') {
        const { wallet, amount } = await readBody(req);
        const result = await economy.requestWithdraw(userId, { wallet, amount });
        if (result.error) {
          return failure(res, result.error, { min: result.min, window: result.window });
        }
        return json(res, 200, { success: true, ...result });
      }

      if (req.method === 'POST' && route === '/api/invite') {
        // Register the referral from the signed start_param, if there is one.
        //
        // This used to return early without ever calling registerReferral, so
        // referrals were dead code: no referee was ever recorded and no
        // referrer ever earned a share. Idempotent — the second and later calls
        // return `already_referred` and change nothing.
        const startParam = String(auth.startParam ?? '').trim();
        let referral = null;
        if (startParam) {
          // startapp payloads are frequently "ref_<id>"; accept either form.
          const referrerId = startParam.replace(/^ref_/, '');
          if (/^\d+$/.test(referrerId)) {
            referral = await economy.registerReferral(userId, referrerId, (channel) =>
              isMember(channel, userId),
            );
          }
        }
        return json(res, 200, { success: true, id: userId, referral });
      }

      // Poll after showing an ad.
      //
      // Monetag confirms the impression server-to-server, so the shift cannot
      // start the instant the SDK Promise resolves: that call would race the
      // postback, return ad_required again, and the UI would snap back to
      // WAITING FOR SHEARING a couple of seconds after the click.
      if (req.method === 'GET' && route === '/api/ads/status') {
        const token = url.searchParams.get('token') ?? '';
        if (!ads) return json(res, 503, { success: false, reason: 'ad_verification_not_configured' });
        if (!token) return json(res, 400, { success: false, reason: 'missing_token' });
        const watched = await ads.isAdWatched(userId, token);
        return json(res, 200, { success: true, watched });
      }

      // Player preferences. The original wrote these straight to the database
      // from the browser; here they go through the server like everything else.
      if (req.method === 'POST' && route === '/api/settings') {
        const body = await readBody(req);
        const patch = {};
        if (typeof body.language === 'string') patch.language = body.language.slice(0, 12);
        if (typeof body.audioEnabled === 'boolean') patch.audioEnabled = body.audioEnabled;
        if (Object.keys(patch).length === 0) {
          return failure(res, ERR.INVALID_AMOUNT);
        }
        await economy.updateSettings(userId, patch);
        return json(res, 200, { success: true });
      }

      if (req.method === 'GET' && route === '/api/me') {
        const config = await economy.config();
        const user = await economy.user(userId);
        return json(res, 200, {
          success: true,
          me: Economy.view(user, config),
          config: { minWithdraw: config.minWithdraw, rateTon: config.rateTon },
        });
      }

      return failure(res, ERR.NOT_FOUND);
    } catch (err) {
      console.error('[api] unhandled', err);
      return failure(res, ERR.SYSTEM);
    }
  };
}
