#!/usr/bin/env python3
"""Build phase2/index.html from the untouched original markup.

Only three things are added, all inside <head> before any app script:
  1. an import map redirecting the two gstatic Firebase modules to local stubs
  2. a Telegram.WebApp stub so the initData gate passes
  3. a window.show_11373165 ad stub
The original body markup and the original bundle are byte-identical to
reference/; the script tag's src is the only rewritten attribute.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT.parent / "reference" / "decompile" / "original.html"

PRELUDE = """  <!-- Phase 2 harness: local Firebase stubs (no network), Telegram + ad stubs -->
  <script type="importmap">
  {
    "imports": {
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js": "/stubs/firebase-app.js",
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js": "/stubs/firebase-database.js"
    }
  }
  </script>
  <script>
  (function () {
    // Seed the in-memory database before the bundle boots.
    window.__FIREBASE_SEED = {
      '.info': { connected: true },
      system_config: { last_payout_time: 0, min_withdraw: 4500000, rate_ton: 450000000 },
      users: {
        '42': { wool: 0, pendingWool: 0, workEndTime: 0, referrals: 0,
                refEarnedWool: 0, lastWithdrawTime: 0, tonWallet: '',
                completedTasks: [], withdrawHistory: [], language: 'en',
                audioEnabled: false }
      }
    };

    var user = { id: 42, first_name: 'Phase2', username: 'phase2_bot', language_code: 'en' };
    window.Telegram = { WebApp: {
      initData: 'auth_date=1&hash=deadbeef&user=' + encodeURIComponent(JSON.stringify(user)),
      initDataUnsafe: { user: user },
      ready: function () {}, expand: function () {}, disableVerticalSwipes: function () {},
      enableClosingConfirmation: function () {}, setHeaderColor: function () {},
      setBackgroundColor: function () {}, openTelegramLink: function (u) { window.__opened = u; },
      shareMessage: function (id) { window.__shared = id; },
      switchInlineQuery: function (id) { window.__inline = id; },
      close: function () {}, isExpanded: true,
      HapticFeedback: { impactOccurred: function () {}, notificationOccurred: function () {} }
    }};

    // Ad SDK stub: records the call and resolves like a watched ad.
    window.__adCalls = [];
    window.show_11373165 = function (opts) {
      window.__adCalls.push(opts);
      console.info('[ad-stub] show_11373165', opts);
      return new Promise(function (resolve) { setTimeout(resolve, 300); });
    };

    // Expose harness controls for the test driver.
    window.__harness = {
      click: function (id) { var el = document.getElementById(id); if (el) { el.click(); return true; } return false; },
      state: function () { return { wool: window.__ls && window.__ls() }; }
    };
  })();
  </script>
"""


def main():
    html = ORIGINAL.read_text(encoding="utf-8")
    # 1. import map + stubs, first thing inside <head>
    html = html.replace("<head>", "<head>\n" + PRELUDE, 1)
    # 2. the bundle URL is local now
    html = html.replace('src="/assets/index-BdmyARw8.js"', 'src="/app.min.js"')
    # 3. assert we did not change anything else structural
    out = ROOT / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html)} bytes)")
    for needle in ("show_11373165", "importmap", "/app.min.js", "background.png"):
        print(f"  {needle:18s} {html.count(needle)}x")


if __name__ == "__main__":
    sys.exit(main())
