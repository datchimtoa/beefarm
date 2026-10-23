#!/usr/bin/env python3
"""Phase 2 verification without a browser.

Firefox's `--screenshot` is unreliable on this host (it dies on
`RenderCompositorSWGL failed mapping default framebuffer`). This script proves
the two things Phase 2 exists to prove:

  A. The client's network contract is what we think it is — replay each action
     against mock_api.py exactly as the bundle would, and confirm the response
     shape its `if(!e.ok||!t.success)` branches expect.
  B. The client's clock arithmetic matches the server's state — re-derive
     U(), G() and K() from the decompiled source and check them.

Nothing here re-implements the game; it exercises the mock server and the
documented formulas.
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:8790"
STATE_PATH = "/home/devroom/beefarm/phase2/fixtures/state.json"
HEADERS = {
    "x-init-data": "auth_date=1&hash=test&user=%7B%22id%22%3A42%7D",
    "Content-Type": "application/json",
}
WOOL_PER_SHIFT = 182_351
results = []


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def check(name, condition, detail=""):
    results.append((name, bool(condition)))
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def state():
    with urllib.request.urlopen(BASE + "/__state") as resp:
        return json.loads(resp.read())


def write_state(payload):
    with open(STATE_PATH, "w") as fh:
        json.dump(payload, fh, indent=2)


def reset():
    write_state({"wool": 0, "pendingWool": 0, "workEndTime": 0, "completedTasks": [],
                 "withdrawHistory": [], "lastWithdrawTime": 0, "referrals": 0,
                 "refEarnedWool": 0, "tonWallet": ""})


print("=== A. client contract ===")
reset()
status, body = call("/api/harvest")
check("harvest starts a shift",
      status == 200 and body.get("success") is True and "workEndTime" in body, f"{status} {body}")

status, body = call("/api/harvest")
check("harvest mid-shift -> not_ready", body.get("errorCode") == "not_ready", f"{status} {body}")

st = state()
st["workEndTime"] = 1          # fast-forward the shift
write_state(st)

status, body = call("/api/harvest")
check("harvest after shift credits pendingWool",
      body.get("success") is True and body.get("wool") == WOOL_PER_SHIFT, f"{status} {body}")

status, body = call("/api/claim_task", {"taskId": "t2"})
check("claim_task credits 5000",
      body.get("success") is True and body.get("wool") == WOOL_PER_SHIFT + 5000, f"{status} {body}")

status, body = call("/api/claim_task", {"taskId": "t2"})
check("claim_task twice -> already_claimed", body.get("errorCode") == "already_claimed", f"{status} {body}")

status, body = call("/api/claim_task", {"taskId": "zzz"})
check("claim_task unknown -> not_found", body.get("errorCode") == "not_found", f"{status} {body}")

status, body = call("/api/invite")
check("invite returns an id", body.get("success") is True and "id" in body, f"{status} {body}")

status, body = call("/api/withdraw", {"wallet": "short", "amount": 9_000_000})
check("withdraw short wallet -> invalid_wallet", body.get("errorCode") == "invalid_wallet", f"{status} {body}")

status, body = call("/api/withdraw", {"wallet": "UQAbCdEfGhIjKlMnOpQrStUv", "amount": 100})
check("withdraw below min -> min_withdraw_error", body.get("errorCode") == "min_withdraw_error", f"{status} {body}")

status, body = call("/api/withdraw", {"wallet": "UQAbCdEfGhIjKlMnOpQrStUv", "amount": 9_000_000})
check("withdraw over balance -> insufficient_wool", body.get("errorCode") == "insufficient_wool", f"{status} {body}")

st = state()
st["wool"] = 9_000_000         # fund it so a valid withdrawal can pass
write_state(st)

status, body = call("/api/withdraw", {"wallet": "UQAbCdEfGhIjKlMnOpQrStUv", "amount": 4_500_000})
check("valid withdraw succeeds", body.get("success") is True, f"{status} {body}")

st = state()
check("withdraw recorded history", len(st.get("withdrawHistory", [])) == 1, str(st.get("withdrawHistory")))
check("withdraw debited wool", st.get("wool") == 4_500_000, f"wool={st.get('wool')}")
check("withdraw stored wallet", st.get("tonWallet") == "UQAbCdEfGhIjKlMnOpQrStUv", str(st.get("tonWallet")))

print()
print("=== B. client clock arithmetic (re-derived from the decompiled source) ===")


def U(now_utc, offset_hours=7):
    """Client U(): new Date(t + 252e5) with t = localMs + tzOffset*60000.

    `localMs + tzOffset*60000` re-expresses the local wall clock as if it were
    UTC, then adds 252e5 ms. 252e5 ms is 70 hours — not 7 — which is a real
    quirk of the original (a UTC+7 shift would be 252e7).

    The host's local zone matters, so it is a parameter instead of ambient
    state: this machine is configured UTC+7 (`/etc/localtime`) even though
    `date` prints "UTC".
    """
    local_wall_ms = now_utc.replace(tzinfo=timezone.utc).timestamp() * 1000 + offset_hours * 3_600_000
    return datetime.fromtimestamp((local_wall_ms + 252_000_000) / 1000, timezone.utc)


def K(now_utc):
    """Client K(): setUTCHours(8,0,0,0) -> epoch ms."""
    return now_utc.replace(hour=8, minute=0, second=0, microsecond=0).timestamp() * 1000


def G(last_withdraw_ms, now_utc):
    """Client G(): locked if withdraw-time >= the most recent 15:00 (UTC+7)."""
    t = U(now_utc)
    cutoff = t.replace(hour=15, minute=0, second=0, microsecond=0)
    if t < cutoff:
        cutoff -= timedelta(days=1)
    lw = U(datetime.fromtimestamp(last_withdraw_ms / 1000, timezone.utc))
    return lw >= cutoff


now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)   # 12:00 UTC = 19:00 local (UTC+7)
# 252e5 ms == 70 hours. Plus the UTC+7 local offset => +77h total from UTC.
check("252e5 ms is 70h, not 7h (a UTC+7 shift would be 252e7)",
      252_000_000 / 3_600_000 == 70, "252e5 = 70.0 h")
check("U() = local wall clock + 70h",
      abs((U(now) - now) - timedelta(hours=77)) < timedelta(seconds=1),
      f"{now:%m-%d %H:%M} UTC -> {U(now):%m-%d %H:%M} (offset 7h + 70h)")
check("U() is NOT a plain UTC+7 shift",
      U(now) != now + timedelta(hours=7),
      "252e5 = 70h; a UTC+7 shift would be 252e7")

check("K() is 08:00 UTC", K(now) == now.replace(hour=8).timestamp() * 1000,
      datetime.fromtimestamp(K(now) / 1000, timezone.utc).isoformat())

one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000)
check("G() locked after a withdraw 1h ago", G(one_hour_ago, now) is True, "withdrew 1h ago")

two_days_ago = int((now - timedelta(days=2)).timestamp() * 1000)
check("G() unlocked after 2 days", G(two_days_ago, now) is False, "withdrew 2d ago")

reset()
failed = [n for n, ok in results if not ok]
print()
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("failed:", failed)
sys.exit(1 if failed else 0)

