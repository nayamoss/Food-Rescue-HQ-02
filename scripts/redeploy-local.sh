#!/bin/bash
# Restart the live app (port 3071, served at foodhq.namosdemos.site) when the code changed and all self-tests pass.
cd "$(dirname "$0")/.." || exit 1
STAMP=/tmp/foodhq-deployed.sig
SIG=$( (git rev-parse HEAD; git diff; find public artifacts/api-server/lib artifacts/api-server/server.js -type f -newer .git/HEAD 2>/dev/null) | shasum | cut -c1-12)
[ -f "$STAMP" ] && [ "$(cat $STAMP)" = "$SIG" ] && { echo "$(date +%H:%M) no changes"; exit 0; }
for t in core voice sms agent estimate; do
  (cd artifacts/api-server && node lib/$t.selftest.mjs >/dev/null 2>&1) || { echo "$(date +%H:%M) $t self-test failed, not deploying"; exit 1; }
done
if git diff --name-only --diff-filter=U | grep -q .; then echo "$(date +%H:%M) unresolved merge conflict, not deploying"; exit 1; fi
if grep -rl -E "^(<<<<<<<|>>>>>>>) " public artifacts/api-server/lib artifacts/api-server/server.js >/dev/null 2>&1; then echo "$(date +%H:%M) conflict markers found, not deploying"; exit 1; fi
for f in public/*.js artifacts/api-server/server.js artifacts/api-server/lib/*.js; do node --check "$f" 2>/dev/null || { echo "$(date +%H:%M) syntax error in $f"; exit 1; }; done
( DATA_DIR=$(mktemp -d) PORT=3999 timeout 6 node server.js >/dev/null 2>&1 & sleep 3; curl -sf -o /dev/null localhost:3999/api/healthz ) || { echo "$(date +%H:%M) server failed to boot, not deploying"; exit 1; }
PID=$(lsof -ti tcp:3071 -sTCP:LISTEN); [ -n "$PID" ] && kill $PID; sleep 1
nohup env PORT=3071 node --env-file=.env server.js >> /tmp/fr-live.log 2>&1 &
sleep 3
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://foodhq.namosdemos.site/api/state)
echo "$SIG" > "$STAMP"
echo "$(date +%H:%M) deployed $(git rev-parse --short HEAD), live check $CODE"
