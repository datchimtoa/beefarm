# Creating the Firebase project (first time)

About **10 minutes**. You need a Google account. No credit card.

You will end up with three values:

| Value | Looks like | Used by |
| --- | --- | --- |
| `FIREBASE_DATABASE_URL` | `https://alod-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app` | our server |
| service account JSON file | a downloaded `.json` file | our server |
| `databaseURL` (+ web config) | `AIza…`, `projectId`, etc. | the **client** the browser loads |

---

## Part 1 — Create the project

1. Open <https://console.firebase.google.com> and sign in.
2. **"Create a project"** (or *Add project*).
3. Project name: **`alod`** (or anything; it must be unique in the URLs).
4. **Disable Google Analytics** — you do not need it, and it adds steps.
5. **Create project** → wait for "Your new project is ready" → **Continue**.

---

## Part 2 — Create the Realtime Database (not Firestore)

This project uses **Realtime Database**. Do not pick Firestore.

1. Left sidebar → **Build** → **Realtime Database**.
2. **Create Database**.
3. Location: pick the closest to your players. The original used
   **`asia-southeast1`** (Singapore) — pick the same for parity.
4. Security rules: choose **"Start in locked mode"**.
   > Locked = nobody can read or write. That is correct: the browser never
   > talks to the database directly, only our server does.
5. **Enable**.

You now see an empty tree and a URL like:

```
https://alod-1234-default-rtdb.asia-southeast1.firebasedatabase.app
```

Copy it — that is `FIREBASE_DATABASE_URL`.

---

## Part 3 — Seed the config node

Our economy reads `system_config` on every request, so you can tune the game
live without redeploying.

1. In Realtime Database, hover the root, open the `⋮` menu → **Import JSON**.
2. Select `server/fixtures/system_config.json` from this repo.
3. Result:

```json
{
  "system_config": {
    "shiftDurationMs": 180000,
    "woolPerShift": 182351,
    "refPercent": 10,
    "minWithdraw": 4500000,
    "rateTon": 450000000,
    "settlementHourUtc": 8,
    "maxWithdrawsPerDay": 1
  }
}
```

> The **original game** used snake_case (`min_withdraw`, `rate_ton`,
> `last_payout_time`). Our server uses camelCase. If the original client must
> also work against this database, add both spellings.

---

## Part 4 — Security rules

Realtime Database → **Rules** tab → paste, then **Publish**:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": { ".read": false, ".write": false },
    "system_config": { ".read": false, ".write": false }
  }
}
```

**Why this matters:** the original left `/users/<telegramId>` world-readable —
I verified that live. Anyone could read a player's wool, wallet address and
withdrawal history by guessing a Telegram id. Do not repeat it.

---

## Part 5 — Service account (for our server)

1. Top-left **gear icon** → **Project settings**.
2. Tab **Service accounts** → **Generate new private key** → **Generate key**.
3. A `.json` downloads. **Treat it like a password.**

```bash
mkdir -p ~/.secrets
mv ~/Downloads/alod-*.json ~/.secrets/alod-service-account.json
chmod 600 ~/.secrets/alod-service-account.json
```

Never commit it. If it leaks, delete the key in the console and make a new one.

---

## Part 6 — Web app config (for the client)

Only needed when the **browser** talks to Firebase directly (the original
client does). Our real API does not need it.

1. **Project settings** → scroll to **Your apps** → **Web** (`</>`).
2. Nickname `alod-web` → **Register app**.
3. Copy the config:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "alod-xxxx.firebaseapp.com",
  databaseURL: "https://alod-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "alod-xxxx",
  storageBucket: "alod-xxxx.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abc123"
};
```

> These values are **public by design** — they ship in the browser. Security
> comes from the rules in Part 4, not from hiding the config.

---

## Part 7 — Point our server at it

```bash
export PATH=/home/devroom/tools/nodejs/bin:$PATH
cd /home/devroom/beefarm/server
npm install firebase-admin

export FIREBASE_DATABASE_URL='https://alod-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app'
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.secrets/alod-service-account.json"
export BOT_TOKEN='123456:your-bot-token-from-BotFather'
node dev-server.js
```

Then switch `dev-server.js` from the memory store to Firebase — one line:

```js
import { FirebaseStore } from './lib/store-firebase.js';
const store = new FirebaseStore({ databaseUrl: process.env.FIREBASE_DATABASE_URL });
```

The store interface is identical, which is the only reason both exist.

---

## Part 8 — Verify it actually works

```bash
# 1. server health
curl -sS http://127.0.0.1:8800/api/health

# 2. auth (dev helper mints a signed payload)
INIT=$(curl -sS http://127.0.0.1:8800/dev/init-data \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["initData"])')
curl -sS -X POST -H "x-init-data: $INIT" http://127.0.0.1:8800/api/harvest
```

If step 2 returns `phase: "shift_started"` **and** a `users/42` node appears in
the Firebase console, you are done.

---

## Your database (verified)

```
https://beefarm-9ad69-default-rtdb.asia-southeast1.firebasedatabase.app
```

Checked on 2026-10-22:

| Probe | Result | Meaning |
| --- | --- | --- |
| `GET /.json` | **401 Permission denied** | database exists, rules are locked ✓ |
| `GET /system_config.json` | **401** | not publicly readable ✓ |
| `GET /users.json` | **401** | **not** leaking player data ✓ |

That last one matters: the original game returned `200` with full user records
here. Yours correctly refuses.

Still needed: the **service account key** (part 5). Without it the server
cannot authenticate.

## Wire it up in three commands

```bash
export PATH=/home/devroom/tools/nodejs/bin:$PATH
cd /home/devroom/beefarm/server

export FIREBASE_DATABASE_URL='https://beefarm-9ad69-default-rtdb.asia-southeast1.firebasedatabase.app'
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.secrets/beefarm-service-account.json"

node check-firebase.js      # validates key + read + write
node dev-server.js          # now persists to Firebase
```

`check-firebase.js` distinguishes the failure modes:

| Output | Cause |
| --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS is not set` | env var missing |
| `cannot read/parse the service account file` | wrong path |
| `service account is missing "client_email"` | wrong JSON downloaded |
| `timed out after 20s` | network / wrong region host |
| `invalid_grant` / `Getting metadata` | key deleted or invalid |
| `OK read system_config` + `OK write + read` | **working** |

## Seeding `system_config`

The check will likely print `(empty: import ...)`. Expected on a fresh
database. Import `server/fixtures/system_config.json` via
Realtime Database → `⋮` → **Import JSON**. Until then the server falls back to
`DEFAULT_CONFIG` in `lib/economy.js` — the game still works, you just cannot
tune it live.

## Where the database is used

Only the server touches it, via the admin SDK. The browser never does — which
is why locked rules are correct rather than a mistake.

```
client  --x-init-data-->  our API  --admin SDK-->  Realtime Database
                          (verifies HMAC)          (rules deny everyone else)
```

## Common mistakes


| Symptom | Cause |
| --- | --- |
| `PERMISSION_DENIED` | Wrong `databaseURL` (admin SDK bypasses rules, so rules are rarely the cause) |
| `404` on the database URL | You created **Firestore** instead of **Realtime Database** |
| `invalid_grant` / credential errors | `GOOGLE_APPLICATION_CREDENTIALS` path wrong, or key deleted |
| Everything reads `null` | Seeded under the wrong root; `system_config` must be a direct child of the root |
| Works locally, fails deployed | Env vars missing on the host |

## Free tier, honestly

Spark (free) includes **1 GB** stored and **10 GB/month** download on Realtime
Database — far more than this game needs at test scale. You are likelier to hit
**simultaneous connection** limits first. For MVP testing, free is fine.

## What about hosting the API on Vercel?

Vercel's serverless functions do not keep long-lived processes, so our
`node:http` handler needs a thin adapter. That is a separate step and not
needed to test locally — say the word when you want to deploy.

