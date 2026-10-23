// Vercel serverless adapter for the API.
//
// Vercel functions are request-scoped and use (req, res) with Node helpers, so
// our node:http handler runs almost unchanged — but two things must NOT be done
// per-invocation:
//   1. Firebase app initialization (warm containers reuse it)
//   2. store construction (it holds the admin app handle)
// Both are memoised at module scope, which Vercel keeps warm between requests.
import { createApp } from '../server/app.js';
import { Economy } from '../server/lib/economy.js';
import { FirebaseStore } from '../server/lib/store-firebase.js';
import { MemoryStore } from '../server/lib/store-memory.js';
import { AdVerifier } from '../server/lib/ads.js';

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
      console.error('[vercel] FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    }
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

export default function handler(req, res) {
  return getApp()(req, res);
}
