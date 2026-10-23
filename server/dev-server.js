// Dev server: runs the real API and serves the client from ../public.
//
//   BOT_TOKEN=123:abc node dev-server.js
//
// Without BOT_TOKEN it falls back to a dev token and signs initData for you,
// so you can exercise the real API from a browser at /dev.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Economy } from './lib/economy.js';
import { MemoryStore } from './lib/store-memory.js';
import { FirebaseStore } from './lib/store-firebase.js';
import { signInitData } from './lib/telegram.js';
import { AdVerifier } from './lib/ads.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', 'public');
const PORT = Number(process.env.PORT ?? 8800);
const BOT_TOKEN = process.env.BOT_TOKEN ?? 'dev:local-token';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Use Firebase when a database URL is configured, otherwise the in-memory
 * store. Falls back loudly rather than silently, because losing persistence
 * by accident is worse than failing to start.
 */
function pickStore() {
  const databaseUrl = process.env.FIREBASE_DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn('[dev] no FIREBASE_DATABASE_URL -> using in-memory store (data is lost on restart)');
    return new MemoryStore();
  }
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  console.log(`[dev] store: Firebase ${databaseUrl}`);
  console.log(`[dev] credentials: ${creds ? `ADC from ${creds}` : 'application default credentials'}`);
  return new FirebaseStore({ databaseUrl });
}

const store = pickStore();

// Ad gating is ON by default. Set DISABLE_AD_GATE=1 for frictionless local play.
const adsEnabled = process.env.DISABLE_AD_GATE !== '1';
const ads = adsEnabled
  ? new AdVerifier({
      secret: process.env.AD_POSTBACK_SECRET ?? 'dev-ad-secret',
      onForgery: (f) => console.warn('[ads] forged postback rejected', f),
    })
  : null;

const economy = new Economy({ store, ads });

const api = createApp({
  economy,
  botToken: BOT_TOKEN,
  ads,
  // Membership cannot be checked without a bot token; deny in dev so the
  // not_member path stays honest.
  isMember: async () => Boolean(process.env.ALLOW_TASK_CLAIMS === '1'),
});

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname.startsWith('/api/')) return api(req, res);

  // Dev helper: mint a valid initData for browser testing.
  if (pathname === '/dev/init-data') {
    const user = { id: Number(process.env.DEV_USER_ID ?? 42), first_name: 'Dev', username: 'dev', language_code: 'en' };
    const body = JSON.stringify({ initData: signInitData(user, BOT_TOKEN), user });
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    return;
  }

  // Dev helper: act as the ad provider and deliver a postback for a token.
  // POST /dev/ad-postback  { "token": "...", "user_id": "42" }
  if (pathname === '/dev/ad-postback' && req.method === 'POST' && ads) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* ignore */
      }
      const token = String(body.token ?? '');
      const userId = String(body.user_id ?? process.env.DEV_USER_ID ?? 42);
      const signature = ads.sign(token, userId);
      // Re-enter through the real endpoint so this exercises the exact code path.
      fetch(`http://127.0.0.1:${PORT}/api/ads/postback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, user_id: userId, signature }),
      })
        .then(async (r) => {
          const out = await r.json();
          res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        })
        .catch((err) => {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
        });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] http://127.0.0.1:${PORT}`);
  console.log(`[dev] bot token: ${BOT_TOKEN === 'dev:local-token' ? 'DEV FALLBACK (do not use in production)' : 'from env'}`);
  console.log(`[dev] task claims: ${process.env.ALLOW_TASK_CLAIMS === '1' ? 'allowed' : 'denied (set ALLOW_TASK_CLAIMS=1)'}`);
  console.log(`[dev] ad gate: ${ads ? 'ON (POST /dev/ad-postback to simulate provider)' : 'OFF (DISABLE_AD_GATE=1)'}`);
});
