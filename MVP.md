# Real MVP — status

Working, tested backend in `server/`. This replaces the Phase 2 mock.

## What is real now

| Concern | Status |
| --- | --- |
| Telegram `initData` HMAC verification | **real** — `server/lib/telegram.js` |
| Replay protection (`auth_date` freshness) | **real** — 24h window, 5 min future-skew guard |
| Server-authoritative shift timing | **real** — client never decides `workEndTime` |
| Double-credit prevention | **real** — one shift at a time, tested |
| Task rewards | **real** — requires a membership probe, paid once |
| Withdrawal validation + daily cap | **real** — server-owned window, funds held on request |
| Admin-tunable economics | **real** — `DEFAULT_CONFIG` overridable from `system_config` |
| 44 automated tests | **passing** (stable across repeated runs) |
| Firebase RTDB store | **live** — verified against `beefarm-9ad69`, survives restart |
| Ad verification | **real** — server-to-server postback, see `ADS-VERIFICATION.md` |
| Referral payouts | **real** — 10% credited on harvest, see `REFERRALS.md` |
| Real ad provider | **contract defined**, awaiting provider choice |
| Client (Phase 3) | **rewritten** — `client/`, Vite + ES modules, no Firebase SDK |
| Vercel deployment | **ready** — `api/index.js` adapter + `vercel.json`, see `DEPLOY-VERCEL.md` |

## Run it

```bash
export PATH=/home/devroom/tools/nodejs/bin:$PATH
cd /home/devroom/beefarm/server
npm test                 # 22/22
node dev-server.js       # http://127.0.0.1:8800
```

## Test the real auth from a shell

```bash
B=http://127.0.0.1:8800

# Rejected: the old mock's fake header no longer works
curl -sS -X POST -H 'x-init-data: test' $B/api/harvest
# -> {"success":false,"errorCode":"unauthorized","reason":"no_hash"}  401

# Accepted: mint a properly signed payload (dev only)
INIT=$(curl -sS $B/dev/init-data | python3 -c 'import sys,json;print(json.load(sys.stdin)["initData"])')
curl -sS -X POST -H "x-init-data: $INIT" $B/api/harvest
# -> {"success":true,"phase":"shift_started","workEndTime":...}
```

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/harvest` | one button, two phases: `shift_started` → `harvest` |
| POST | `/api/claim_task` | `{taskId}`; requires membership |
| POST | `/api/withdraw` | `{wallet, amount}`; admin cap applies |
| POST | `/api/invite` | returns the user's referral id |
| GET | `/api/me` | current balance + live config |

All require `x-init-data`. Missing/invalid → **401** (the client freezes on its
auth modal by design).

## Admin controls

Edit `DEFAULT_CONFIG` in `server/lib/economy.js`, or override per-deployment
via the `system_config` Firebase node (same shape):

```json
{
  "shiftDurationMs": 180000,
  "woolPerShift": 182351,
  "refPercent": 10,
  "minWithdraw": 4500000,
  "rateTon": 450000000,
  "settlementHourUtc": 8,
  "maxWithdrawsPerDay": 1
}
```

Because config is read from the store on **every** request, changing
`maxWithdrawsPerDay` or `rateTon` takes effect immediately — no redeploy.

## Going to Firebase

```bash
cd server && npm i firebase-admin
export BOT_TOKEN='123456:ABC...'
export FIREBASE_DATABASE_URL='https://<project>-default-rtdb.<region>.firebasedatabase.app'
export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json
node dev-server.js        # swap MemoryStore -> FirebaseStore in dev-server.js
```

Then apply `server/database.rules.json` — it denies **all** client access; only
the admin SDK reads and writes. This matters: the original left `/users/*`
world-readable.

## Known gaps before this is a live game

1. **Ad verification is not implemented.** The client calls an ad SDK and then
   tells the server "done". A determined user skips the ad. Real fix: provider
   postback (server-to-server) keyed to the Telegram id, verified before the
   shift completes.
2. **Referral payout is not wired.** `registerReferral` records the link, but
   the 10% cut is not credited on each harvest yet.
3. **No payout sender.** Withdrawals are validated and held, but nothing sends
   TON. That is deliberate: payouts must be a reviewed, idempotent job.
4. **Membership probe is stubbed** in dev (`ALLOW_TASK_CLAIMS=1` forces true).
   Production needs `getChatMember` with the bot token.
5. **No rate limiting** beyond the daily withdraw cap.
