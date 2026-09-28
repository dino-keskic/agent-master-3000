#!/usr/bin/env bash
# Start the board if needed, then open it. Safe to run when it is already up.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-live}"
if [[ "$mode" == "scratch" ]]; then
  ui=3998
  api=3002
  start_cmd=(npm run dev:scratch)
else
  ui=3999
  api=3001
  start_cmd=(npm run dev)
fi

url="http://127.0.0.1:${ui}/"

listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

ready() {
  listening "$ui" && listening "$api"
}

open_board() {
  echo "ready at ${url}"
  open "$url" >/dev/null 2>&1 || true
}

if ready; then
  open_board
  exit 0
fi

if listening "$ui" || listening "$api"; then
  echo "Agent Master 3000: ${ui}/${api} is only half-up. Stop the leftover node process and try again." >&2
  lsof -nP -iTCP:"$ui","$api" -sTCP:LISTEN >&2 || true
  exit 1
fi

(
  for _ in $(seq 1 80); do
    if ready; then
      open_board
      exit 0
    fi
    sleep 0.25
  done
  echo "Agent Master 3000 did not come up on ${url}" >&2
  exit 1
) &

exec "${start_cmd[@]}"
