# Agent Master 3000

These are the working rules for anyone changing this repo — people, and the
coding agents they run. The first three sections exist because the board
drives a real OpenCode install on the machine it runs on.

## The host's OpenCode install is off limits

On a developer's machine the board drives their **real** OpenCode: their
sessions, their credentials, their MCP tokens, their private repos. None of it
is an agent's to read or run.

**Never**, for any reason, including "just checking what the API returns":

- Read `~/.local/share/opencode/**` (the `opencode.db` with every session and
  message), `~/.config/opencode/**` (config, agent files, MCP client secrets),
  `~/.cache/opencode/**`, or any other host OpenCode state.
- Run `opencode` on the host at all — no `opencode acp`, `opencode serve`,
  `opencode run`, `opencode mcp`, `opencode models`, no `--help` probing that
  spawns an instance, no scripts that spawn one.
- Query, connect to, or spawn the host's MCP servers.
- Touch the running board (see below), or send it anything but read-only browsing.

If you need to know how OpenCode behaves — its ACP handshake, its HTTP API, the
DB schema, how MCP tools are exposed — **use the Docker sandbox**. It has its own
OpenCode, its own config dir, its own database, and none of the host's data.
Never "just this once" on the host: ask the person you are working for instead.

Code that reads OpenCode state (`server/opencode/`, `server/opencode/models.ts`,
`server/setup/locations.ts`)
is fine to *write and read*. Running it against the host's real files, by hand or
through a scratch server, is not.

## The sandbox

```bash
npm run sandbox:test      # npm test in the container
npm run sandbox:sh        # a bash shell in it
npm run sandbox:board     # the board at http://127.0.0.1:4999 (API 4001)
npm run sandbox:probe     # OpenCode's tool ids / MCP status / agents
npm run sandbox:down      # stop and drop the sandbox volume
```

The repo is baked into the image (Docker VMs such as Colima's only mount `$HOME`), so the
scripts rebuild first — only the last layer, `npm ci` stays cached.

Everything the container writes is disposable: `$HOME`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_DB` and its board state all live under `/sandbox`, seeded from
`sandbox/seed/`. `sandbox/mcp/echo-mcp.mjs` is a stub MCP server so tool/MCP work
has something real to enumerate without any account. See `sandbox/README.md`.

## The running board — do not touch

The board a developer already has running on the default ports is the one they
work in, with their real tasks — **not** a disposable dev server.

| | Live (`npm run dev`) | Scratch (agents / VS Code debug) |
|---|---|---|
| UI | http://127.0.0.1:3999 | http://127.0.0.1:3998 |
| API / WS | http://127.0.0.1:3001 | http://127.0.0.1:3002 |
| State file | `data/board_state.json` | `data/board_state.scratch.json` |

**Never** bind, kill, restart, or proxy-over 3999 or 3001. Do not send the live process `SIGTERM`/`kill`. Do not run `npm run dev` / `npm run client` / `npm run server` if those ports are already in use. Do not point a scratch server at `data/board_state.json`.

`tsx watch` on the live server restarts when `server/` files change. Prefer verifying server changes on the scratch instance. If a live reload is unavoidable, say so; do not also bounce the process yourself.

## How to run a scratch instance

```bash
npm run dev:scratch
```

Or VS Code F5 / Run Task:

- **Agent Master 3000** — http://127.0.0.1:3999 (API 3001, `data/board_state.json`). Reuses the process if it is already up.
- **Agent Master 3000 (scratch)** — http://127.0.0.1:3998 (API 3002, `data/board_state.scratch.json`)

Env the scratch stack sets:

- `PORT=3002`
- `VITE_DEV_PORT=3998`
- `API_PORT=3002`
- `BOARD_STATE_FILE=data/board_state.scratch.json`

The live stack is `npm run dev` (UI 3999 → API 3001).

## How the code is organized

Three layers, and the rule that keeps them apart:

| | What lives there | What must not |
|---|---|---|
| `shared/` | Pure logic: decisions, formatting, merges, parsing. Imported by the server, the client and the tests alike. | Reach for `fs`, `child_process`, `window`, `api`, React, or the clock as an ambient input. |
| `server/` | I/O: the ACP child process, HTTP routes, the state file, git, the OpenCode database. | Hold decisions that could be made without any of it. |
| `src/` | React: what is on screen, and the hooks that feed it. | Hold logic the tests cannot reach. |
| `desktop/` | The Mac app's Electron main process: starting the board, its window, the menu. | Hold decisions; those go in `shared/desktop/`. |

**Pure logic goes in `shared/` and gets a test in the same commit. I/O stays in
`server/`. `src/` arranges.** There is no jsdom or React Testing Library in this
repo, and there is not going to be one: a component's behaviour is testable
exactly to the extent that its decisions were moved into `shared/` first. That
is the whole reason for the layer.

Inside a layer, files are grouped by **feature**, and a feature keeps the same
name in every layer — the spend report is `shared/spend/`, its routes are
`server/routes/spend.ts`, its calls are `src/api/spend.ts` and its screen is
`src/components/spend/`. Nothing new goes loose at a layer's root; the few
files there (`server/index.ts`, `shared/types.ts`, `shared/ids.ts`, …) are
used by every feature.

| Layer | Folders |
|---|---|
| `server/` | `acp/` the agent process and protocol · `turns/` running a turn · `opencode/` its DB, config and HTTP API · `board/` the task store and state file · `live/` publishing to sockets · `git/` · `mcp/` the board's own MCP server · `toolCatalog/` what tools a session has · `trackers/` Jira/GitHub lookups · `speech/` · `setup/` locations and first run · `app/` the board's own paths, shutdown, opening things on the desktop · `http/` the Express app, the built client, request guards · `routes/` one file per API area |
| `shared/` | Mirrors those features (`agent/`, `board/`, `task/`, `sessions/`, `review/`, `notifications/`, `spend/`, `composer/`, …). A feature's report types live beside it (`spend/types.ts`); `types.ts` holds only what the board's state is made of. |
| `desktop/` | `main.ts` the app and its window · `boardProcess.ts` the board in a utility process · `shellEnv.ts` the login shell's environment. Built by `scripts/build-desktop.mjs`, packed by `electron-builder.yml` (`npm run desktop`). |
| `src/` | `app/` the shell and board-wide hooks · `api/` one file per feature, merged into `api` by `index.ts` · `components/<feature>/` a feature's screen and its hooks · `speech/` dictation |

Tests mirror the source tree: `server/board/taskStore.ts` is tested in
`tests/server/board/taskStore*.test.ts`, `shared/spend/history.ts` in
`tests/shared/spend/history.test.ts`. Helpers more than one test file needs go
in `tests/fixtures/`.

## The built app

`npm run build` also bundles the server (`scripts/build-server.mjs`, esbuild)
into `dist-server/`, and `agent-master-3000` / `npm start` run that bundle on plain
`node`, serving `dist/` on one port (3737). There is no `tsx` and no repo
around it, so in `server/`:

- A path to one of the board's own files goes through `server/app/appPaths.ts`
  (`PACKAGE_ROOT`, `CLIENT_DIR`, `SERVER_BUNDLE_DIR`), never `process.cwd()`.
- Anything the board writes goes under `dataDir()` — `./data` from a checkout,
  `~/.local/share/agent-master-3000` when built. Never a hard-coded `data/`.
- Anything that finds OpenCode — the executable, its config folders, the
  sessions DB, the model list, the environment it is started with — asks
  `server/setup/locations.ts`, never `~/.config/opencode` or `process.env` directly,
  so a location changed in Settings reaches all of it.
- A non-code file loaded by `import.meta.url` must be added to `ASSETS` in
  `scripts/build-server.mjs`, or the installed app will not have it.

Do not run the built app on the host either — nor the desktop app from
`release/`: both read the host's OpenCode just like the dev server. The desktop
app runs on Linux too, so try it in Docker under `xvfb-run` with the fake agent. Smoke-test a tarball in Docker (`node:22`, fake agent).

## Size

A file past **400 lines** is telling you it is doing more than one thing. It is
a smell, not a lint error — split it by *job*, never to get under a number, and
if the jobs really are one job, leave it and say why in the header comment.

A function should be readable without scrolling. A component's own body should
read as an arrangement of parts: the pieces it puts on screen, and what a
submit means. If you have to skim past a 200-line `return` to find the state, it
is two components.

When a component outgrows its file, make a directory beside it named after it
and give each job a file:

- **A decision** — what a menu row inserts, which sessions are live, how a
  filter prunes → `shared/`, with a test.
- **Talking to the server, and the state it lands in** → a hook in that
  directory (`useTaskDiff`, `useComposerMenu`, `useBoardData`).
- **A self-contained region of the screen** → its own component
  (`TurnControls`, `HunkTable`, `DiffToolbar`).
- **What is left** — the arrangement, and what a submit means — stays in the
  original file, which is now the map of the feature.

Worked examples to copy: `src/app/App.tsx` with the hooks beside it in `src/app/`,
`src/components/composer/Composer.tsx` with `src/components/composer/`, and
`src/components/diff/DiffView.tsx` with `src/components/diff/`.

## React patterns this codebase has settled on

- **Derive, never duplicate.** The open task is held as an id and looked up in
  the task list, so a card and the drawer showing it cannot disagree. Two copies
  of the same fact is the bug you will spend the afternoon on.
- **Adjust state during render, not in a prop-sync effect.** See
  `useProjectFilter`: a filter naming a deleted project is corrected while
  rendering, so no frame is painted with it. This only terminates because the
  helper returns *the same array reference* when there is nothing to drop —
  whatever you do this with must have that property.
- **Effects are for external systems**, and every fetch inside one carries a
  `cancelled` flag its cleanup sets.
- **Callbacks read by something outside React go through a ref.** The
  WebSocket handlers (`useBoardSocket`) and the desktop-notification click
  handler are read out of `latest.current`, so a render never costs a
  reconnect.
- **Anything reaching a memoised component keeps its identity.** `TaskCard` is
  wrapped in `React.memo`; a fresh closure per render for `onSelectTask` would
  re-render the whole board on every status tick, which is most of what a
  running turn costs the browser. Hence the `useCallback`s in `useTaskActions`.
- `react-hooks/set-state-in-effect` is a **warning**, and what it is allowed to
  cover is data arriving: mount-time and visibility loads, and the composer's
  lookup debounce. Every prop-sync effect that used to trip it has been
  converted. Do not add more; a new one is a bug, not a warning.

## Comments

Header comment on every module: what it is for, and what belongs in it. Then
comments where the code cannot say it itself — why this order, why this cap,
what breaks without it. Do not restate what the line already says, and do not
leave a comment describing a state of the code that is no longer true.

## Before you commit

```bash
npx tsc --noEmit && npx eslint . && npm test && npm run build
```

`eslint` must report **zero errors**; the standing warnings are the ones the
config explains. `npm test` runs `node:test` through `tsx` — tests live in
`tests/`, one file per module, at the same path as the module it tests.
