#!/usr/bin/env bash
# Runs a command in a Node container with this repository's web/ directory
# mounted at /work, and docs/ and anim/ mounted read-only at /docs and /anim (so
# `../../docs` resolves from /work/site just as it does from web/site on the host).
# Files it writes are owned by you, not root.
# usage: node.sh SUBDIR COMMAND...        e.g.  node.sh site npm run build
# env: NODE_IMAGE  image to use (default: node:latest)
#      GATE        passed through: GATE=1 builds the site with the gates' test pages
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(dirname "$WEB")
SUBDIR=${1:?usage: node.sh SUBDIR COMMAND...}
shift
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_update_notifier=false \
  -e ASTRO_TELEMETRY_DISABLED=1 \
  -e GATE="${GATE:-}" \
  -v "$WEB:/work" -w "/work/$SUBDIR" \
  -v "$ROOT/docs:/docs:ro" -v "$ROOT/anim:/anim:ro" \
  "${NODE_IMAGE:-node:latest}" "$@"
