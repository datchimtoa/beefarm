# Trying it on your phone (Telegram Mini App)

## Quick answer

```bash
cd /home/devroom/beefarm
./phase2/share.sh          # prints a https://<random>.trycloudflare.com URL
./phase2/share.sh stop     # stop tunnel + server
```

That URL is already live right now:

```
https://eat-admitted-register-conferences.trycloudflare.com
```

Quick Tunnel URLs are random and change on every start.

## Two ways to open it

### A. Plain browser (fastest check)

Just open the URL. The harness already injects a fake `Telegram.WebApp`, so the
`initData` gate passes and the game renders. You get the stubbed preview with
the mock `/api`.

### B. Real Telegram Mini App

Inside Telegram there is no need for the stub — Telegram provides
`initData` itself. To wire it up:

1. **@BotFather** → `/newbot` (or `/mybots` → your bot) → **Bot Settings** →
   **Menu Button** → edit the button URL, or **Configure Mini App** → set the
   Web App URL to the tunnel URL above.
2. Open your bot and tap the menu button. The app loads inside Telegram.
3. **This is the important bit:** the original bundle sends
   `initData` to `/api` in the `x-init-data` header and expects it to be
   verified. `mock_api.py` only checks that the header is *present* — it does
   **not** verify the HMAC signature. That is fine for local testing, and is
   explicitly **not** safe for production. Phase 4 replaces it with real
   verification.

## Caveats, so nothing surprises you

| Thing | Reality |
| --- | --- |
| URL changes every restart | Quick Tunnels are ephemeral. For a stable URL you need a Cloudflare account + named tunnel (`cloudflared tunnel login`, `tunnel create`, DNS routing). |
| State is global, not per user | `fixtures/state.json` is one shared record — every visitor shares the same wool balance. |
| Only one user at a time is expected | The mock keys nothing by Telegram ID yet. |
| `x-init-data` is not verified | Anyone who knows the URL can call `/api/*`. Testing only. |
| Some Telegram UI won't appear | `close`, `expand`, haptics etc. are stubbed or absent in the browser case. |
| Tunnel exposes this machine | It serves **only** `phase2/` on that port. Nothing else on the host is exposed. |

## If the tunnel URL fails

- Check the tunnel log: `tail -f /tmp/phase2-tunnel.log`
- Check the server log: `tail -f /tmp/phase2-server.log`
- Quick Tunnels are sometimes rate-limited or blocked on some networks; if
  `trycloudflare.com` is unreachable from your phone, a named tunnel or ngrok
  is the fallback.

## Install prerequisites (already done here)

```bash
curl -sSL -o tools/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x tools/cloudflared
./tools/cloudflared --version   # 2026.10.3
```
