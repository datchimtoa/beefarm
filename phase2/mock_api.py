#!/usr/bin/env python3
"""Phase 2 mock `/api` — serves the static shell AND the four endpoints the
original bundle calls.

Purpose: prove our reading of the client is correct. This is NOT the real
backend; it is the smallest implementation that satisfies the contract derived
from decompiling `original.min.js`:

  POST /api/harvest    -> starts a shift (sets workEndTime) or credits wool
  POST /api/claim_task -> {taskId} -> credits the task reward
  POST /api/invite     -> returns { success, id } for shareMessage()
  POST /api/withdraw   -> {wallet, amount} -> validates, records history

Responses are `{success: bool, errorCode?: str, ...}`; the client maps
errorCode through its own i18n keys (`api_<errorCode>`).
"""
import json
import os
import re
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(ROOT, "fixtures", "state.json")

SHIFT_MS = int(os.environ.get("SHIFT_MS", 180_000))       # 3 min, like the original
WOOL_PER_SHIFT = int(os.environ.get("WOOL_PER_SHIFT", 182_351))
TASK_REWARD = 5_000
MIN_WITHDRAW = 4_500_000
RATE_TON = 450_000_000                                    # wool per GRAM
TASKS = {"t1", "t2", "t3", "t4"}

DEFAULTS = {
    "wool": 0,
    "pendingWool": 0,
    "workEndTime": 0,
    "refEarnedWool": 0,
    "referrals": 0,
    "withdrawHistory": [],
    "lastWithdrawTime": 0,
    "tonWallet": "",
    "audioEnabled": True,
    "language": "en",
    "completedTasks": [],
    "minWithdraw": MIN_WITHDRAW,
    "rateTon": RATE_TON,
    "lastPayoutTime": 0,
}


def load_state():
    try:
        with open(STATE_PATH) as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    state = dict(DEFAULTS)
    state.update(data)
    return state


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as fh:
        json.dump(state, fh, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[mockapi] %s\n" % (fmt % args))

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/__state"):
            return self._json(load_state())
        if re.fullmatch(r"/\.well-known/appspecific/com\.chrome\.devtools\.json", self.path):
            return self._json({})
        return super().do_GET()

    def do_POST(self):
        route = self.path.split("?")[0]
        if not (self.headers.get("x-init-data") or ""):
            # The client treats 401 as a hard auth failure.
            return self._json({"success": False, "errorCode": "unauthorized"}, 401)

        state = load_state()
        now = int(time.time() * 1000)

        if route == "/api/harvest":
            if state["pendingWool"] > 0 and now < state["workEndTime"]:
                return self._json({"success": False, "errorCode": "not_ready"}, 400)
            if state["pendingWool"] > 0 and now >= state["workEndTime"]:
                state["wool"] += state["pendingWool"]
                state["pendingWool"] = 0
                save_state(state)
                return self._json({"success": True, "wool": state["wool"]})
            state["pendingWool"] = WOOL_PER_SHIFT
            state["workEndTime"] = now + SHIFT_MS
            save_state(state)
            return self._json({"success": True, "workEndTime": state["workEndTime"]})

        if route == "/api/claim_task":
            task_id = (self._body() or {}).get("taskId")
            if task_id not in TASKS:
                return self._json({"success": False, "errorCode": "not_found"}, 404)
            done = state.setdefault("completedTasks", [])
            if task_id in done:
                return self._json({"success": False, "errorCode": "already_claimed"}, 400)
            done.append(task_id)
            state["wool"] += TASK_REWARD
            save_state(state)
            return self._json({"success": True, "wool": state["wool"], "reward": TASK_REWARD})

        if route == "/api/invite":
            return self._json({"success": True, "id": "ref-" + str(int(now))})

        if route == "/api/withdraw":
            body = self._body() or {}
            wallet = str(body.get("wallet") or "").strip()
            try:
                amount = int(body.get("amount") or 0)
            except (TypeError, ValueError):
                return self._json({"success": False, "errorCode": "invalid_amount"}, 400)
            if len(wallet) < 10:
                return self._json({"success": False, "errorCode": "invalid_wallet"}, 400)
            if amount < MIN_WITHDRAW:
                return self._json({"success": False, "errorCode": "min_withdraw_error", "min": MIN_WITHDRAW}, 400)
            if amount > state["wool"]:
                return self._json({"success": False, "errorCode": "insufficient_wool"}, 400)
            state["wool"] -= amount
            state["lastWithdrawTime"] = now
            state["tonWallet"] = wallet
            state.setdefault("withdrawHistory", []).append(
                {"amount": round(amount / RATE_TON, 4), "wallet": wallet, "timestamp": now}
            )
            save_state(state)
            return self._json({"success": True})

        return self._json({"success": False, "errorCode": "not_found"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[mockapi] http://127.0.0.1:{port}  (SHIFT_MS={SHIFT_MS}, WOOL_PER_SHIFT={WOOL_PER_SHIFT})")
    server.serve_forever()


if __name__ == "__main__":
    main()
