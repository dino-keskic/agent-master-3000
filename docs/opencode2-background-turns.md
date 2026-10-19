# Turns that outlive the board on OpenCode 2

A finding, not a shipped feature. Everything here was measured in the repo's
Docker sandbox on OpenCode **2.0.24** (`npm run sandbox:*`, built with
`--build-arg OPENCODE_VERSION=2.0.24`) with a stub OpenAI-compatible model on
`127.0.0.1:4321`. Nothing was run against a host OpenCode.

The question: can a turn the board starts keep running after the board quits,
and can the board pick it up again when it comes back?

## Short answer

| | Answer |
|---|---|
| 1. Can `opencode acp` attach to a long-running server? | **No.** `acp` takes no flags, always starts a private in-process server, and there is no env var to point it elsewhere. Its turns die with it. |
| 2. Can the board drive turns over the v2 HTTP API against a server that outlives it? | **Yes.** `opencode service` runs a detached `serve --service`; a turn started over `POST /api/session/{id}/prompt` ran to completion after the client went away. |
| 3. Can a restarted board re-attach to a running turn and stream the rest? | **Yes, with one gap.** `GET /api/session/active` + the message list + `GET /api/event` gets you everything except the text deltas of the *part in progress* that were emitted while you were away; they arrive in full on `session.text.ended`. |
| Bonus | The **service** resumes a turn that was interrupted mid-execution (it crashed, was killed, the machine rebooted) by itself when it next starts. `opencode acp` never does. |

Recommendation: add a second transport, a **service driver** that speaks the v2
HTTP API to the background service, behind the same `AcpEvent` feed the rest of
the server already consumes. Keep the `opencode acp` child for 1.x and as a
fallback. Details at the end.

## 1. `opencode acp` cannot attach

From the 2.0.24 binary (`/usr/local/lib/node_modules/@opencode/cli/bin/opencode.exe`):

- The top-level options include `--standalone` ("Run with a private server
  instead of the background service") and `--server <url>` ("Connect to a
  server URL instead of the background service"). They apply to the TUI and
  the client commands.
- `acp` is declared with no options at all
  (`{description:"Start an Agent Client Protocol server"}`). It sets
  `OPENCODE_CLIENT=acp`, boots a private server in its own process, and talks to
  it over HTTP internally ("server exited unexpectedly" is its error when that
  dies).
- Env vars it reads: `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_DB`,
  `OPENCODE_PASSWORD`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_ROUTE` (TUI only),
  the `OPENCODE_DISABLE_*` family. None names a server to connect to.

What a SIGKILLed `acp` leaves behind (`acpclient.mjs "slow:30" 4000`): the
assistant step is closed as

```json
{"type":"assistant","finish":"error",
 "error":{"type":"aborted","message":"Step interrupted"},
 "time":{"created":…,"completed":…}}
```

and nothing resumes it — a fresh `opencode acp` with `session/load`, and a
plain `opencode serve --port`, both leave it there.

`initialize` reply on 2.0.24, for reference:

```json
{"protocolVersion":1,
 "agentCapabilities":{"loadSession":true,
   "sessionCapabilities":{"additionalDirectories":{},"close":{},"delete":{},"fork":{},"list":{},"resume":{}},
   "_meta":{"opencode/child-session-updates":true}},
 "agentInfo":{"name":"OpenCode","version":"2.0.24"}}
```

## 2. Driving turns over the v2 HTTP API

### The background service

```bash
opencode service start      # status | stop | restart | get | set | unset
```

starts `opencode.exe serve --service` detached (ppid 1) and writes
`$XDG_STATE_HOME/opencode/service.json` (mode 0600):

```json
{"id":"…","version":"2.0.24","url":"http://127.0.0.1:49374","pid":371,"password":"…"}
```

Every request needs basic auth, user `opencode`, that password; without it, 401.
The OpenAPI document is `GET /openapi.json` (~270 KB, saved in the notes
folder with an operation list). **The user's own `opencode` TUI uses this same
service by default** — it is one per user, not one per board.

### The calls a turn needs

| Purpose | Call |
|---|---|
| New session | `POST /api/session` `{location:{directory}, agent?, model?, title?, parentID?, permissions?:[{action,resource,effect}]}` |
| Send a prompt | `POST /api/session/{id}/prompt` `{text, files?, delivery:"steer"\|"queue"}` — returns at once with the user message |
| Watch it | `GET /api/event` — one global SSE stream for every session; filter on `data.sessionID` |
| What is running | `GET /api/session/active` → `{"data":{"ses_…":{"type":"running"}}}` |
| Transcript | `GET /api/session/{id}/message?order=asc&limit&cursor` |
| Cancel | `POST /api/session/{id}/interrupt` → `{"interrupted":true}` |
| Pending approvals | `GET /api/session/{id}/permission` (or `GET /api/permission/request?location[directory]=…`) |
| Answer one | `POST /api/session/{id}/permission/{per_…}/reply` `{"decision":"once"\|"always"\|"reject","message"?}` |

Not useful: `GET /api/experimental/session/{id}/log?follow` only ever emits
`log.synced` with a sequence number; `Last-Event-ID` on `/api/event` does not
replay anything.

### One turn's events

`/api/event`, in order, for a prompt that calls one shell tool (`tool: please`
against the stub):

```
server.connected
session.inbox.enqueued     {inboxID, sessionID, item:{type:"user",payload:{text},delivery}}
session.execution.started  {sessionID}
session.instructions.updated
session.inbox.delivered
session.step.started
session.tool.input.started / session.tool.input.ended
session.tool.called
permission.asked           (only if the session's rules say ask)
permission.replied
session.tool.progress
session.tool.success
session.step.ended         {finish, cost, tokens}
session.step.started
session.text.started
session.text.delta         {assistantMessageID, ordinal, delta}      ← ephemeral
session.text.ended         {…, text}                                 ← the whole part
session.step.streamed / session.step.ended
session.usage.updated, session.renamed
session.execution.succeeded
```

Durable events carry `durable:{aggregateID:<sessionID>, seq, version}`; deltas
carry none. Ids are `evt_…`.

A permission request:

```json
{"id":"per_…","sessionID":"ses_…","action":"shell",
 "resources":["touch /p/ws/marker","echo from-tool"],
 "save":["touch *","echo *"],
 "source":{"type":"tool","messageID":"msg_…","id":"call_1"}}
```

A global `"permission":{"shell":"ask"}` in `opencode.json` was **not** applied
to service sessions (not even after `opencode reload`); passing
`permissions:[{"action":"shell","resource":"*","effect":"ask"}]` on
`POST /api/session` was.

### Leaving mid-turn

`http.mjs start "slow:20" 3000` creates a session, prompts, reads the stream for
3 s and exits. Afterwards `session/active` still listed it as running, and the
message list ended with the full `tick1 … tick20 DONE-SLOW` text and an idle row
`{"type":"idle","outcome":"succeeded"}`.

A permission asked while nobody is listening simply waits; a reply sent minutes
later (`perm.sh`) let the tool run and the turn finish.

`interrupt` writes `{"type":"idle","outcome":"interrupted"}` and closes the
step with the same `aborted / "Step interrupted"` error as a killed `acp`.

## 3. Re-attaching

`http.mjs attach <sid>` after a client dropped out of a `slow:30` turn:

1. `GET /api/session/active` — the session is `running`.
2. `GET /api/session/{id}/message?order=asc` — the user message and every
   finished part are there. The text part in progress is present with
   `text:""`: deltas are not persisted until the part ends.
3. `GET /api/event` — from then on the remaining `session.text.delta`s arrive,
   then `session.text.ended` with the **complete** text of the part, then
   `session.execution.succeeded`.

So the only loss is cosmetic and temporary: the text the part had already
streamed while the board was away is missing from the live view until
`session.text.ended` replaces it. Tool parts carry their state in the message
row and are not affected.

### The service resumes crashed turns

Kill the service (or the container) mid-turn and start it again: within about
5–10 s it appends a synthetic message

```json
{"type":"synthetic","metadata":{"notice":"restart"},
 "text":"The server restarted while you were working. Continue from where you left off without repeating completed work."}
```

and runs a new step. It did this for a turn originally started by
`opencode acp` too, once the service was pointed at the same DB
(`acp-killed-then-service-resumed.messages.json` in the notes). Neither a new
`acp` nor a plain `serve --port` does this.

## Recommended design

### `server/acp/` → a second transport

Today `AcpTransport` owns the `opencode acp` child, and `AcpManager` stacks the
registry, approval desk, transcript stream, configurator, lifecycle and turn
runner on top of the JSON-RPC it produces. Add, beside it:

- **`server/opencode/service.ts`** — find the service: read `service.json`
  under the state dir that `server/setup/locations.ts` resolves (add it there,
  next to the DB path), `opencode service start` if it is absent or its `pid` is
  gone, check `version`. All paths and the binary come from `locations.ts`.
- **`server/acp/serviceTransport.ts`** — the HTTP + SSE client: one
  `/api/event` connection with reconnect and backoff (the board's equivalent of
  the child's restart loop), the calls in the table above, and nothing else.
- **`shared/agent/v2Events.ts`** (pure, tested) — translate a v2 event into what
  `TranscriptStream` and `ApprovalDesk` already take: `session.text.delta` →
  an `agent_message_chunk` keyed by `assistantMessageID:ordinal`;
  `session.text.ended` → *replace* that item's text (this is what heals a
  re-attach); `session.tool.*` → `tool_call` / `tool_call_update` with
  `call_…` ids; `permission.asked` → the `awaiting_input` request shape;
  `session.execution.succeeded|failed` and the idle row → `status_change`.
  Plus the snapshot half: a message list → the `TaskLogItem`s it implies, so a
  re-attach can rebuild the log before live events resume.
- A small `TransportPort` interface both transports satisfy (prompt, cancel,
  newSession, loadSession, reply-to-permission, set model/agent, events), so
  `AcpManager`'s collaborators do not care which one they sit on. Pick the
  transport per OpenCode major version at boot, with a setting to force the
  `acp` child.

Tool policy cannot ride on the `OPENCODE_CONFIG` policy file any more: the
service is shared and was started without the board's env. Send it as the
session's `permissions` ruleset on create (verified above) and, when a policy
changes, update open sessions (`experimental.config.update` exists but is
experimental; re-check before relying on it).

### `server/turns/`

- `TurnOrchestrator` and `registerAcpEvents` keep consuming `AcpEvent`s
  unchanged.
- New: on boot, when the service driver is in use, ask `GET /api/session/active`
  for running sessions, map them to tasks through the session ids the task
  store already holds, rebuild each task's log from the message snapshot, mark
  the task running, and subscribe. Same path for a running session found in a
  task's subagent tree.
- A turn's end is the `session.execution.*` event or the idle row, never the
  process going away.

### `isAbandonedTurn` and `boardStartedAt`

The `boardStartedAt` rule says "a turn last written before this board started
was running inside our `acp` child, which died with us". That stays true for
the child, and becomes false for the service.

- Keep the rule, but apply it only to sessions the board ran through the `acp`
  child (1.x, or the forced fallback). The simplest way is for the reader to be
  told which transport is live: with the service driver, pass
  `boardStartedAt = 0`.
- For service-driven sessions, liveness comes from `GET /api/session/active`,
  not from DB write times. The 15-minute silence rule can stay as a backstop for
  a service that is not reachable.
- Independently of all this, on 2.x a step with
  `error.type:"aborted"` or a trailing idle row is *finished*; the reader should
  treat it so instead of waiting out the silence window.

### Caveats to weigh before building it

- **Shared with the user.** The service is the same one the user's TUI talks
  to. Stopping or restarting it from the board would kill their work; the board
  should start it if absent and otherwise never touch its lifecycle.
- **Config is global.** The service reads one config dir; the board can no
  longer give its turns a private config through env. Anything board-specific
  must go through session rules or the API.
- **Experimental surface.** `/api/experimental/*` and parts of the event shapes
  are new in 2.x and may move; pin the tested version range like the ACP path
  does.
- **The password is in a 0600 file** in the user's state dir — reading it is the
  intended way to authenticate, but it is still a credential and must never
  reach logs or the client.
- **The delta gap** on re-attach, described above.
- **Crash resume is automatic.** A turn the user thought was dead may come back
  after a reboot. The board should show it, and offer "interrupt".

## Reproducing

Probe scripts (`env.sh`, `stub.mjs`, `acpclient.mjs`, `http.mjs`, `perm.sh`, the
two `opencode*.json`) and the raw payloads (`event.raw`, `ev3.raw`,
`openapi.json`, `operations.txt`, the resumed transcript) are in the side-session
notes folder for this investigation, not in the repo. In short:

```bash
docker run -d --name oc2probe <sandbox image built with OPENCODE_VERSION=2.0.24> sleep infinity
docker cp probe/. oc2probe:/p/
docker exec oc2probe bash -lc '. /p/env.sh; node /p/stub.mjs & opencode service start'
docker exec oc2probe bash -lc '. /p/env.sh; node /p/http.mjs start "slow:20" 3000'
docker exec oc2probe bash -lc '. /p/env.sh; node /p/http.mjs attach ses_…'
```
