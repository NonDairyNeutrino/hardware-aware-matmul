#!/usr/bin/env bash
# Serve ROOT, open URLPATH in headless Firefox, wait for the page to POST its
# report, then stop both. Prints nothing; the report is left in $REPORT.
# usage: run_page.sh ROOT URLPATH [TIMEOUT_SECONDS]      env: PORT, REPORT, LOG
set -u
ROOT=$1
URLPATH=$2
TIMEOUT=${3:-120}
PORT=${PORT:-8765}
HERE=$(cd "$(dirname "$0")" && pwd)
: "${REPORT:?set REPORT to the file the report is written to}"
rm -f "$REPORT"
export REPORT LOG

( cd "$ROOT" && exec python3 -I "$HERE/serve.py" "$PORT" ) &
SERVER=$!
PROFILE=$(mktemp -d)
firefox --headless --no-remote --profile "$PROFILE" "http://127.0.0.1:$PORT/$URLPATH" >/dev/null 2>&1 &
BROWSER=$!

cleanup() {
  kill "$BROWSER" "$SERVER" 2>/dev/null
  sleep 1
  kill -9 "$BROWSER" "$SERVER" 2>/dev/null
  rm -rf "$PROFILE"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

for _ in $(seq 1 "$TIMEOUT"); do
  [ -f "$REPORT" ] && break
  sleep 1
done

[ -f "$REPORT" ]
