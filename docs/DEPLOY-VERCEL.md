# Deploying to Vercel

The repo is now deploy-shaped: static client in `client/dist`, API in
`api/index.js`, routing in `vercel.json`.

## What gets deployed

| Path | Role |
| --- | --- |
| `client/` | Vite app → builds to `client/dist` (static) |
| `api/index.js` | All `/api/*` rewritten here → serverless function |
| `server/` | Shared logic (auth, economy, ads, stores) — imported by the function |
| `public/` | Original markup/CSS/assets, copied into the build verbatim |

`vercel.json` already wires: build command, output dir, `/api/(.*)` rewrite,
immutable caching for `/assets/*`.

## Environment variables (required)

Set these in **Vercel → Project → Settings → Environment Variables**
(Production *and* Preview).

| Variable | Required | Notes |
| --- | --- | --- |
| `BOT_TOKEN` | **yes** | From BotFather. Without it every `initData` check fails with 401. |
| `FIREBASE_DATABASE_URL` | **yes** | `https://beefarm-9ad69-default-rtdb.asia-southeast1.firebasedatabase.app` |
| `FIREBASE_SERVICE_ACCOUNT` | **yes** | The **entire service-account JSON as one string**. |
| `AD_POSTBACK_SECRET` | recommended | Enables the ad gate. Omit and shifts start without an ad. |
| `ALLOW_TASK_CLAIMS` | optional | `1` bypasses the membership check. **Leave unset in production.** |

### Getting `FIREBASE_SERVICE_ACCOUNT` right

There is no filesystem on Vercel, so the key goes in an env var. The JSON must
be **one line**. On your machine:

```bash
python3 -c "import json;print(json.dumps(json.load(open('$HOME/.secrets/beefarm-service-account.json'))))" \
  | wc -c     # expect ~2300 chars
```

Paste that single line as the value. `\n` in `private_key` must stay escaped —
do not let an editor turn them into real newlines.

## Deploy

There is no `vercel` CLI on this machine. Two options:

**A. Dashboard (easiest)**
1. Push this repo to GitHub (a `.gitignore` already excludes `node_modules`,
   `dist`, `.env`, and `*service-account*.json`).
2. vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other**. Build command and output dir come from
   `vercel.json`.
4. Add the env vars above, then **Deploy**.

**B. CLI**
```bash
npm i -g vercel
cd /home/devroom/beefarm
vercel link
vercel env add BOT_TOKEN production
# ...repeat for each var
vercel --prod
```

## After it deploys — the part that actually matters

A green deploy does **not** mean the game works. Three things must be checked,
in this order:

### 1. The API answers
```bash
curl -s https://<your-app>.vercel.app/api/health
# {"success":true,"ok":true,"ts":...}
```

### 2. Auth rejects garbage
```bash
curl -s -X POST -H 'x-init-data: bogus' https://<your-app>.vercel.app/api/harvest
# {"success":false,"errorCode":"unauthorized","reason":"no_hash"}
```
If this returns 200, `BOT_TOKEN` is missing and Telegram would accept anything.

### 3. It works inside Telegram
In BotFather: **Bot Settings → Menu Button** (or *Configure Mini App*) → set the
Web App URL to your deployment.

Then open the bot and tap the button. What you should see:
- the loading screen, then the farm
- SHEAR → (ad) → 3:00 countdown → HARVEST
- wool in the header pill

## Reading errors on the player's screen

This is why we did the rewrite. Unlike the original:

| Failure | What the player sees now | What the original did |
| --- | --- | --- |
| No `initData` | "Open this game from Telegram, not a browser." | blank page / redirect to a 404 |
| Rejected session (401) | "Session expired. Please reopen…" | **froze forever** on a promise that never settled |
| Network / CORS / offline | "Cannot reach the server." + Retry | silent hang |
| Any API error code | the mapped message, e.g. "Not enough wool." | raw `api_*` key text |
| Unknown code | `Something went wrong (<code>).` | nothing |

The panel is `#fatal-error` in `client/src/index.html`. To debug a specific
screen, open the Mini App, and check **Vercel → Deployments → Functions → logs**
for the same timestamp.

## Known limitations on Vercel

1. **Ad-verifier state is per-instance.** `AdVerifier` keeps tokens in memory,
   so a postback can reach a different instance than the shift request and the
   player is told to watch again. Fine for a single test user; move the store to
   Redis/Firebase before real traffic.
2. **Cold starts** add ~1s to the first request after idle.
3. **Membership checks are stubbed** — `ALLOW_TASK_CLAIMS=1` bypasses them.
   Real `getChatMember` calls are not wired yet.
4. **No payout sender.** Withdrawals are validated and funds held; nothing
   sends TON.
