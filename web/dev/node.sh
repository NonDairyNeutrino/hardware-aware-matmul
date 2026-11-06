#!/usr/bin/env bash
# Runs a command in a Node container with this repository's web/ directory
# mounted at /work. Files it writes are owned by you, not root.
# usage: node.sh SUBDIR COMMAND...        e.g.  node.sh site npm run build
# env: NODE_IMAGE  image to use (default: node:latest)
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
SUBDIR=${1:?usage: node.sh SUBDIR COMMAND...}
shift
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_update_notifier=false \
  -e ASTRO_TELEMETRY_DISABLED=1 \
  -v "$WEB:/work" -w "/work/$SUBDIR" \
  "${NODE_IMAGE:-node:latest}" "$@"
