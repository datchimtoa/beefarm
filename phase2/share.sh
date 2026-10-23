#!/usr/bin/env bash
# Serve phase2 locally and expose it on a public HTTPS URL via a Cloudflare
# Quick Tunnel (no account needed). Prints the URL to use as a Telegram
# Mini App / Web App URL.
#
#   ./phase2/share.sh          # start + print URL
#   ./phase2/share.sh stop     # stop tunnel and server
#
# Notes:
#  - The mock /api keeps state in fixtures/state.json, so your progress
#    survives page reloads.
#  - Quick Tunnel URLs are random and change every start.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$HERE/../tools"
PORT="${PORT:-8790}"
LOG_TUNNEL=/tmp/phase2-tunnel.log
LOG_SERVER=/tmp/phase2-server.log

stop_all() {
  [[ -f /tmp/phase2-tunnel.pid ]] && kill "$(cat /tmp/phase2-tunnel.pid)" 2>/dev/null || true
  [[ -f /tmp/phase2-server.pid ]] && kill "$(cat /tmp/phase2-server.pid)" 2>/dev/null || true
  rm -f /tmp/phase2-tunnel.pid /tmp/phase2-server.pid
  echo "stopped"
}

if [[ "${1:-}" == "stop" ]]; then
  stop_all
  exit 0
fi

if [[ ! -x "$TOOLS/cloudflared" ]]; then
  echo "cloudflared missing. Install with:"
  echo "  curl -sSL -o tools/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
  echo "  chmod +x tools/cloudflared"
  exit 1
fi

# 1. mock server (also serves the static shell)
if ! (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
  ( cd "$HERE" && setsid nohup python3 mock_api.py "$PORT" > "$LOG_SERVER" 2>&1 < /dev/null & echo $! > /tmp/phase2-server.pid )
  sleep 2
  echo "server: http://127.0.0.1:$PORT"
else
  echo "server: already running on $PORT"
fi

# 2. quick tunnel
( setsid nohup "$TOOLS/cloudflared" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > "$LOG_TUNNEL" 2>&1 < /dev/null & echo $! > /tmp/phase2-tunnel.pid )

for _ in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_TUNNEL" | head -1 || true)
  [[ -n "${URL:-}" ]] && break
  sleep 1
done

if [[ -z "${URL:-}" ]]; then
  echo "tunnel did not come up; see $LOG_TUNNEL"
  exit 1
fi

echo
echo "public URL: $URL"
echo
echo "Open it as a Telegram Mini App (or in a browser for the stubbed preview)."
echo "Stop with: $0 stop"
