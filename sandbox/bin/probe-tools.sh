#!/usr/bin/env bash
# Dump what OpenCode says it can do, from inside the sandbox.
#
#   docker compose -f sandbox/compose.yml run --rm board sandbox/bin/probe-tools.sh
#
# Starts a throwaway `opencode serve`, asks it for tool ids and MCP status, and
# shuts it down. Run this instead of ever pointing a probe at the host.
#
# OpenCode 2 answers under /api/ instead, with no tool-id list; `/api/info`
# answering JSON is how this tells which one it started.
set -euo pipefail

PORT="${PROBE_PORT:-3010}"
DIR="${PROBE_DIR:-/sandbox/workspace}"
mkdir -p "$DIR"

export OPENCODE_SERVER_PASSWORD="probe-$RANDOM$RANDOM"
AUTH=(-u "opencode:$OPENCODE_SERVER_PASSWORD")
BASE="http://127.0.0.1:$PORT"

opencode serve --port "$PORT" --hostname 127.0.0.1 >/tmp/opencode-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -sf -m 2 "${AUTH[@]}" "$BASE/doc" >/dev/null && break
  curl -sf -m 2 "${AUTH[@]}" "$BASE/api/info" >/dev/null && break
  sleep 0.5
done

get() { curl -s -m 30 "${AUTH[@]}" "$BASE$1"; }

if get /api/info | jq -e '.version' >/dev/null 2>&1; then
  LOC="location%5Bdirectory%5D=$(jq -rn --arg d "$DIR" '$d|@uri')"
  echo "== OpenCode $(get /api/info | jq -r .version)"
  # The first request about a folder starts loading it; wait until it has.
  for _ in $(seq 1 40); do
    [ "$(get "/api/agent?$LOC" | jq '.data | length')" -gt 0 ] && break
    sleep 0.25
  done

  echo "== mcp servers"
  get "/api/mcp?$LOC" | jq '.data'

  echo "== agents"
  get "/api/agent?$LOC" | jq -r '.data[] | "\(.id)\tdeny=\([.permissions[] | select(.effect == "deny" and (.resource // "*") == "*") | .action])"'

  echo "== config permissions, by document"
  get "/api/config?$LOC" | jq -c '.[] | select(.info.permissions) | {path, permissions: .info.permissions}'
  exit 0
fi

echo "== tool ids (built-ins)"
get "/experimental/tool/ids?directory=$DIR" | jq .

echo "== mcp servers"
get "/mcp?directory=$DIR" | jq .

echo "== agents"
get "/agent?directory=$DIR" | jq -r '.[] | "\(.name)\ttools=\(.tools)"'

echo "== openapi paths mentioning tools/mcp"
get /doc | jq -r '.paths | to_entries[] | select(.key | test("tool|mcp")) | .key'
