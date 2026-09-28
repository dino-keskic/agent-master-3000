# Sandbox

A container with OpenCode, Node and the board's dependencies in it. **This is the
only place an agent may run OpenCode.** The host's OpenCode — its config, its
`opencode.db`, its credentials, its MCP servers — is off limits (see
`../AGENTS.md`).

## Use it

```bash
npm run sandbox:test      # npm test in the container, no network
npm run sandbox:e2e       # the board against a real `opencode acp` (below)
npm run sandbox:sh        # a bash shell in it
npm run sandbox:board     # the board at http://127.0.0.1:4999 (API 4001)
npm run sandbox:probe     # OpenCode's tool ids / MCP status / agents
npm run sandbox:build     # just build the image
npm run sandbox:down      # stop and drop the volume
```

Every script but `sandbox:down` rebuilds the image first. That is cheap: only the
last layer (the repo) is rebuilt, `npm ci` stays cached.

## End to end: `npm run sandbox:e2e`

`sandbox/e2e/opencode.e2e.ts` starts the board server, which starts a real
`opencode acp`, which talks to `sandbox/e2e/stubLlm.ts`: a scripted
OpenAI-compatible endpoint on 127.0.0.1, registered as an
`@ai-sdk/openai-compatible` provider (bundled with OpenCode, so there is no
install step). It creates a task over HTTP and runs a turn, then checks that
the stub's reply streams into the transcript over the websocket. It then drives
a `bash` tool call through the board's permission prompt and reads the session
back from OpenCode's database: the session list, the model, the tokens and the
history. It also fails on any `[OpenCode DB]` warning, which is how schema drift
shows up.

It is sealed (`sandbox/compose.e2e.yml`):

- `network_mode: none`: the container has only `lo`. On the default bridge a
  container can reach services bound to the host's loopback through the VM
  (`host.lima.internal`), and so could reach a host OpenCode. With no network
  that path is gone, and so are the npm registry and models.dev.
- No published ports, no volumes or bind mounts, no host environment, all
  capabilities dropped. HOME, OpenCode's config and DB, and the board state all
  live in a fresh `/tmp/acp-e2e-*` directory, and `--rm` removes the rest.
- OpenCode runs with `OPENCODE_DISABLE_AUTOUPDATE`, `…_MODELS_FETCH`,
  `…_LSP_DOWNLOAD` and `…_SHARE`, so it does not try the network at all.
- The test refuses to start outside a container (`ACP_E2E=1` and `/.dockerenv`).
  `npm test` never picks it up, because it is not under `tests/`.

`sandbox:test` is sealed the same way: the `test` service has no network and no
state volume.

`ACP_E2E_KEEP=1` keeps the temp directory for a look afterwards (use
`docker compose -f sandbox/compose.e2e.yml run -e ACP_E2E_KEEP=1 e2e sh`, then
`npm run test:e2e`).

### OpenCode versions

The image installs `opencode-ai@$OPENCODE_VERSION`, and the Dockerfile default is
the pin. To run the e2e against another release (the image is tagged
`agent-master-3000-e2e:<version>`, and only the OpenCode layer rebuilds):

```bash
OPENCODE_VERSION=1.18.32 npm run sandbox:e2e
```

Passing on 1.14.51, 1.16.2, 1.17.20, 1.18.0, 1.18.10, 1.18.20 and 1.18.32 (the
pin). OpenCode 1.14 sends a permission request with empty `rawInput`,
and the board takes the arguments from the tool call's earlier update. Older
releases are untested. When you bump the pin, run the e2e on the new version
first.

Node: the unit suite passes on 22.13+, 24 and 26 (the image). Below 22.13
`node:sqlite` needs a flag, so `engines` says `>=22.13`.

## Why the code is baked in, not mounted

Under **Colima**, the VM mounts only `$HOME` by default. When the repo lives
outside it — on an external or secondary volume, say — a bind mount silently
produces empty directories inside the container, so `sandbox/Dockerfile` copies
the repo in instead. Hence the rebuild-first scripts.

To get live reload instead, mount the repo's volume into the VM once
(`colima stop && colima start --mount /path/to/volume:w`), then add a
`volumes: [../:/app, /app/node_modules]` entry to the `board` service. Colima has
to restart, which stops every other container on the machine, so that is the
user's call, not an agent's.

Colima also does not forward published ports for `docker compose run` containers,
only for `compose up` — that is why the board runs as its own `dev` service.

## What is where

| | Path in the container |
|---|---|
| Repo (baked at build time) | `/app` |
| `node_modules` (linux binaries, from `npm ci`) | `/app/node_modules` |
| `HOME`, OpenCode config, OpenCode DB, board state | `/sandbox/…` |
| Scratch directory for OpenCode to work in | `/sandbox/workspace` |

`/sandbox` is a named volume seeded from `sandbox/seed/` on first run. Everything
OpenCode writes lands there and `npm run sandbox:down` throws it away. The repo's
`data/board_state.json` is never read or written — `BOARD_STATE_FILE` points at
`/sandbox/board_state.json`, and `data/` is in `.dockerignore`.

Published ports: `4001` (API), `4999` (UI), `4010` (probe server) — clear of the
live board (3001/3999) and the scratch stack (3002/3998). They are published on
the host's `127.0.0.1` only. Inside the container the board binds `0.0.0.0`, so
its start-up log carries the "not loopback" warning; that is expected here.

## Agents and MCP

- `ACP_COMMAND` defaults to `node tests/fixtures/fakeAgent.mjs` — deterministic,
  offline, no account.
- For the real protocol: `ACP_COMMAND="opencode acp" npm run server` inside the
  container. There are no credentials in the sandbox, so a turn against a real
  provider will not complete. For turns that do complete, point OpenCode at the
  stub LLM the way `sandbox/e2e/opencode.e2e.ts` does.
- `sandbox/mcp/echo-mcp.mjs` is a stub MCP server registered in
  `sandbox/seed/opencode.json` as `sandbox-echo`. It gives tool-inventory work a
  real MCP server to enumerate instead of a real one you use.
