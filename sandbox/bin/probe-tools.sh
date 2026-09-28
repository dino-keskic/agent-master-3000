#!/usr/bin/env bash
# Dump what OpenCode says it can do, from inside the sandbox.
#
#   docker compose -f sandbox/compose.yml run --rm board sandbox/bin/probe-tools.sh
#
# Starts a throwaway `opencode serve`, asks it for tool ids and MCP status, and
# shuts it down. Run this instead of ever pointing a probe at the host.
set -euo pipefail

PORT="${PROBE_PORT:-3010}"
DIR="${PROBE_DIR:-/sandbox/workspace}"
mkdir -p "$DIR"

opencode serve --port "$PORT" --hostname 127.0.0.1 >/tmp/opencode-serve.log 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -sf -m 2 "http://127.0.0.1:$PORT/doc" >/dev/null && break
  sleep 0.5
done

echo "== tool ids (built-ins)"
curl -s -m 30 "http://127.0.0.1:$PORT/experimental/tool/ids?directory=$DIR" | jq .

echo "== mcp servers"
curl -s -m 30 "http://127.0.0.1:$PORT/mcp?directory=$DIR" | jq .

echo "== agents"
curl -s -m 30 "http://127.0.0.1:$PORT/agent?directory=$DIR" | jq -r '.[] | "\(.name)\ttools=\(.tools)"'

echo "== openapi paths mentioning tools/mcp"
curl -s -m 30 "http://127.0.0.1:$PORT/doc" \
  | jq -r '.paths | to_entries[] | select(.key | test("tool|mcp")) | .key'
