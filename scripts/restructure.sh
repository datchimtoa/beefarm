#!/usr/bin/env bash
# Restructure the repo into a conventional apps/ layout.
#
# Before:                        After:
#   api/index.js                 apps/api/vercel.js
#   server/                      apps/api/            (logic, tests, config)
#   client/                      apps/web/            (vite app)
#   public/                      apps/web/public/     (static shell + assets)
#   phase2/                      reference/history/phase2/  (superseded)
#   *.md (8 files)               docs/
#
# Run once. Idempotent guard at the top prevents double-running.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -d apps ]]; then
  echo "apps/ already exists - refusing to run again" >&2
  exit 1
fi

echo "== apps/api =="
mkdir -p apps/api
git mv server apps/api 2>/dev/null || mv server apps/api
mkdir -p apps/api/handler
mv api/index.js apps/api/handler/vercel.js 2>/dev/null || true
rmdir api 2>/dev/null || true

echo "== apps/web =="
mkdir -p apps/web
git mv client apps/web 2>/dev/null || mv client apps/web
# The static shell belongs to the web app.
git mv public apps/web/public 2>/dev/null || mv public apps/web/public

echo "== reference/history =="
mkdir -p reference/history
mv phase2 reference/history/phase2

echo "== docs =="
for f in *.md; do
  [[ -e "$f" ]] || continue
  [[ "$f" == "README.md" ]] && continue
  mv "$f" docs/
done

echo "== tools =="
rmdir tools 2>/dev/null || true

echo "done"
