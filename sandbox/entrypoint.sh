#!/usr/bin/env bash
# Prepares the disposable /sandbox tree, then runs whatever was asked for.
set -euo pipefail

mkdir -p \
  "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" \
  "$OPENCODE_CONFIG_DIR" "$(dirname "$OPENCODE_DB")" \
  /sandbox/workspace

# Seeded on first run and whenever the volume was dropped. Editing the copy in
# /sandbox is fine — it is thrown away with the volume; edit sandbox/seed/ for
# something that should survive.
if [ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ] && [ -f /app/sandbox/seed/opencode.json ]; then
  cp /app/sandbox/seed/opencode.json "$OPENCODE_CONFIG_DIR/opencode.json"
fi

# Jira and GitHub answers, without an account. The stand-in CLIs go ahead of
# the real (deliberately signed-out) ones, which stay installed so the failure
# path is still the real failure path. Off by default: `MENTION_MOCKS=1`.
if [ "${MENTION_MOCKS:-0}" = "1" ]; then
  PATH="/app/tests/fixtures/cli:$PATH"
  export PATH
fi

if [ ! -x /app/node_modules/.bin/tsx ]; then
  echo "[sandbox] /app/node_modules looks empty — run 'npm run sandbox:build' on the host." >&2
fi

exec "$@"
