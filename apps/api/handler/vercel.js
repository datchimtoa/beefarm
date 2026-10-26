// Vercel serverless adapter for the API.
//
// Vercel functions are request-scoped and use (req, res) with Node helpers, so
// our node:http handler runs almost unchanged — but two things must NOT be done
// per-invocation:
//   1. Firebase app initialization (warm containers reuse it)
//   2. store construction (it holds the admin app handle)
// Both are memoised at module scope, which Vercel keeps warm between requests.
import { createApp } from '../app.js';
import { Economy } from '../lib/economy.js';
import { FirebaseStore } from '../lib/store-firebase.js';
import { MemoryStore } from '../lib/store-memory.js';
import { AdVerifier } from '../lib/ads.js';
import { AdminService } from '../lib/admin.js';

let app;

function buildStore() {
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) {
    console.warn('[vercel] FIREBASE_DATABASE_URL missing -> in-memory store (data will NOT persist)');
    return new MemoryStore();
  }
  // On Vercel the service account is supplied as a JSON string in an env var,
  // because there is no filesystem path to ~/.secrets.
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      // A malformed key used to fall through to application-default credentials,
      // which then retried OAuth forever and surfaced as a 500 timeout.
      throw new Error(
        '[vercel] FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole ' +
          'service-account file as one line (see docs/DEPLOY-VERCEL.md).'
      );
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error(
        '[vercel] FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key. ' +
          'Download the key from Firebase console > Project settings > Service accounts.'
      );
    }
  } else {
    // No key at all: applicationDefault() cannot work on Vercel (no metadata
    // server for this project, no local credentials file). Fail fast and say so
    // rather than hanging on repeated OAuth attempts.
    throw new Error(
      '[vercel] FIREBASE_SERVICE_ACCOUNT is not set. The API cannot reach Firebase; ' +
        'see docs/DEPLOY-VERCEL.md.'
    );
  }
  return new FirebaseStore({ databaseUrl: url, serviceAccount });
}

function getApp() {
  if (app) return app;

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error('[vercel] BOT_TOKEN missing: every initData check will fail');
  }

  const store = buildStore();

  // The verifier must share the durable store: on Vercel the postback routinely
  // lands on a different instance than the one that issued the token, so an
  // in-process map would never find it and the reward would be lost.
  const ads = process.env.AD_POSTBACK_SECRET
    ? new AdVerifier({ secret: process.env.AD_POSTBACK_SECRET, store })
    : null;

  const economy = new Economy({ store, ads });

  // Real membership check, replacing the ALLOW_TASK_CLAIMS placeholder.
  //
  // The placeholder returned true for everyone once enabled, so "join the
  // channel" was decorative: any player could claim the reward without ever
  // joining, and a referral could be credited without a join too. Telegram's
  // getChatMember is the only trustworthy source.
  //
  // Failure is treated as "not a member". A Telegram outage should briefly
  // block claiming, never silently hand out rewards.
  const isMember = async (channel, userId) => {
    if (!botToken) return false;
    const chat = String(channel ?? '').trim();
    const id = String(userId ?? '').trim();
    if (!chat || !id) return false;
    try {
      const target = chat.startsWith('@') ? chat : `@${chat}`;
      const resp = await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember` +
          `?chat_id=${encodeURIComponent(target)}&user_id=${encodeURIComponent(id)}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (!resp.ok) return false;
      const body = await resp.json();
      if (!body.ok) return false;
      const status = body.result?.status;
      // 'left' and 'kicked' are the only states that mean "not in the channel".
      return status === 'creator' || status === 'administrator' || status === 'member';
    } catch (err) {
      console.warn('[vercel] getChatMember failed:', err?.message ?? err);
      return false;
    }
  };

  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (!adminToken) console.warn('[vercel] ADMIN_TOKEN missing: admin API disabled');

  app = createApp({
    economy,
    botToken: botToken ?? '',
    ads,
    isMember,
    admin: adminToken ? new AdminService({ store, economy }) : null,
    adminToken,
  });
  return app;
}

export default async function handler(req, res) {
  let app;
  try {
    app = getApp();
  } catch (err) {
    // Misconfiguration must be readable from the player's screen and the logs.
    // Returning a bare 500 gives only FUNCTION_INVOCATION_FAILED, which hides
    // the real cause (missing FIREBASE_SERVICE_ACCOUNT, malformed key, ...).
    console.error('[vercel] startup failed:', err.message);
    const body = JSON.stringify({
      success: false,
      errorCode: 'system_error',
      reason: err.message,
    });
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  return app(req, res);
}
