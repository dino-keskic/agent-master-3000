#!/usr/bin/env bash
# Seeds a board, starts the server with the streaming fake agent and the probe,
# drives it with load-test.mjs, and prints what the probe saw. Sandbox only:
#   docker run --rm agent-master-3000-sandbox sandbox/bin/load-test.sh
# Tunables: SEED_TASKS, TASKS, ROUNDS, CLIENTS, ACP_FAKE_ROUNDS/CHUNKS/CHUNK_MS.
set -euo pipefail
cd /app

STATE=/sandbox/board_state.json
PROBE_LOG=/sandbox/probe.log
rm -rf "$STATE" "$STATE".* "$PROBE_LOG" /sandbox/board_state.logs
mkdir -p /sandbox/workspace
node sandbox/bin/load-test.mjs seed "$STATE" "${SEED_TASKS:-70}"

BOARD_STATE_FILE="$STATE" PROBE_LOG="$PROBE_LOG" PORT=3001 \
  ACP_COMMAND="node tests/fixtures/fakeAgent.mjs" ACP_FAKE_SCRIPT=stream \
  node --import tsx --import ./sandbox/bin/probe.mjs server/index.ts > /sandbox/server.log 2>&1 &
SERVER=$!
until curl -sf http://127.0.0.1:3001/api/projects > /dev/null; do sleep 0.2; done

if ! node sandbox/bin/load-test.mjs run; then
  echo "--- load test failed; server log tail"
  tail -60 /sandbox/server.log
fi
sleep 2
kill -TERM "$SERVER"
wait "$SERVER" || true

echo "--- probe (per second: rss/heap MB, event-loop delay ms, state writes)"
jq -s '{
  seconds: length,
  rssMaxMb: (map(.rssMb) | max), heapMaxMb: (map(.heapMb) | max), heapEndMb: .[-1].heapMb,
  lagP99Max: (map(.lagP99) | max), lagMax: (map(.lagMax) | max),
  lagP99Median: (map(.lagP99) | sort | .[length / 2 | floor]),
  stateWrites: (map(.writes) | add), stateWriteMb: (map(.writeMb) | add), stateWriteMs: (map(.writeMs) | add),
  transcriptWrites: (map(.transcriptWrites // 0) | add), transcriptMb: (map(.transcriptMb // 0) | add)
}' "$PROBE_LOG"
[ -n "${PROBE_DETAIL:-}" ] && cat "$PROBE_LOG"
ls -la /sandbox | grep board_state || true
du -sh /sandbox/board_state* 2>/dev/null || true
grep -ciE 'error|unhandled' /sandbox/server.log || true
