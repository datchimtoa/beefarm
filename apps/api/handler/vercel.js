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

  const ads = process.env.AD_POSTBACK_SECRET
    ? new AdVerifier({ secret: process.env.AD_POSTBACK_SECRET })
    : null;

  const economy = new Economy({ store: buildStore(), ads });

  app = createApp({
    economy,
    botToken: botToken ?? '',
    ads,
    // Placeholder: replace with a real getChatMember call before launch.
    isMember: async () => process.env.ALLOW_TASK_CLAIMS === '1',
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
