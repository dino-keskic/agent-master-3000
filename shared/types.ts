/**
 * The board's vocabulary: a task, its columns, its sessions, the requests an
 * agent can block on, and the settings behind all of it. Imported by the
 * server, the client and the tests, so they cannot drift apart.
 *
 * Long, and one file on purpose — these are declarations, not logic, and the
 * point of them is that there is one place to look up what a board word means.
 * What a single feature reports rather than what the board is made of lives
 * beside that feature: the spend report in `spend/types.ts`, OpenCode's session
 * listings, subagents, models and agents in `sessions/types.ts`.
 */

import { PromptImage } from './composer/promptImages.js';

export type { PromptImage };

/** Runtime overlay — independent of which column the card sits in. */
export type TaskRunState = 'idle' | 'running' | 'error' | 'awaiting_input';

/** How the board answers the agent's permission requests. */
export type PermissionMode = 'auto' | 'review-writes' | 'manual';

/** ACP PermissionOptionKind. */
export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/**
 * An ACP `session/request_permission` the board is holding open. The agent's
 * turn is blocked on the JSON-RPC response until the user answers.
 */
export interface PendingPermission {
  type: 'permission';
  /** Correlates the answer back to the parked JSON-RPC request. */
  requestId: string;
  askedAt: number;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

/** One field of an `elicitation/create` form. */
export interface QuestionField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string;
  description?: string;
  required: boolean;
  /** Present when the schema constrains the value to a fixed set. */
  options?: string[];
  default?: string | number | boolean | string[];
}

/** An ACP `elicitation/create` the board is holding open. */
export interface PendingQuestion {
  type: 'question';
  requestId: string;
  askedAt: number;
  message: string;
  /** 'url' elicitations just point the user somewhere. */
  mode: 'form' | 'url';
  url?: string;
  fields: QuestionField[];
}

export type PendingRequest = PendingPermission | PendingQuestion;

/**
 * A prompt the user sent while a turn was already running. The board holds it
 * and starts it when the running turn ends, so typing ahead never interrupts
 * the agent. Ordered oldest-first; the whole queue is visible on the card.
 */
export interface QueuedTurn {
  id: string;
  /** Absent for a column's on-enter run, which carries its prompt separately. */
  prompt?: string;
  queuedAt: number;
  /** The linked session this turn will run in, when it is already known. */
  sessionId?: string;
  /** Images dropped into the composer with this prompt. */
  images?: PromptImage[];
}

/** What the user (or the board) answered. */
export type PermissionAnswer =
  | { kind: 'permission'; requestId: string; optionId: string }
  | { kind: 'question'; requestId: string; action: 'accept'; content: Record<string, string | number | boolean | string[]> }
  | { kind: 'question'; requestId: string; action: 'decline' | 'cancel' };

export interface BoardColumn {
  id: string;
  title: string;
  /** Sent as the user turn when the column's prompt is used. Empty = none. */
  prompt: string;
  /** When true, dropping a task here starts a turn with `prompt` (if set). */
  autoRun: boolean;
  /** When true, dropping a task here compacts its session before `prompt` runs. */
  compactOnEnter?: boolean;
  /** When true, moving a task here archives the current session and starts a fresh one for this stage. */
  newSessionOnEnter?: boolean;
  /** Applied on enter when set; omit to leave the task's model alone. */
  model?: string;
  agent?: string;
  thinkingLevel?: string;
  /** Applied on enter when set; omit to leave the task's permission mode alone. */
  permissionMode?: PermissionMode;
}

export type ThinkingLevel = string;

export interface ThinkingLevelOption {
  value: string;
  name: string;
}

export type TaskLogType =
  | 'info'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'agent_say'
  | 'user_say'
  | 'error'
  | 'status_change';

/** Mirrors the lifecycle ACP reports for a tool call. */
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolCallInfo {
  /** ACP toolCallId — also used as the log item id so updates merge in place. */
  toolCallId: string;
  /** Tool name as first reported by the agent, e.g. "read", "glob", "bash". */
  name: string;
  /** ACP tool kind: search | read | edit | execute | fetch | think | other. */
  kind?: string;
  status: ToolCallStatus;
  rawInput?: Record<string, unknown>;
  output?: string;
  /** Absolute paths the tool touched. */
  locations?: string[];
  /** Child session this call handed the work to, for subagent tools. */
  subagentSessionId?: string;
  /** Which subagent ran it — the requested type, else the child session's agent. */
  subagentName?: string;
}

/**
 * A tool call still in flight, attached to list/push snapshots so the
 * background-tasks view does not need the transcript those payloads omit.
 */
export interface ActiveToolCall {
  toolCall: ToolCallInfo;
  sessionId?: string;
  startedAt: number;
}

export interface TaskLogItem {
  id: string;
  timestamp: number;
  type: TaskLogType;
  title?: string;
  text: string;
  /** Present on 'tool_call' entries. */
  toolCall?: ToolCallInfo;
  /**
   * Images that went to the agent with this turn. References only — the bytes
   * are on disk, so a transcript full of screenshots does not become the
   * state file.
   */
  images?: PromptImage[];
  metadata?: Record<string, unknown>;
  /** The session this log belongs to when a task has multiple linked sessions. */
  sessionId?: string;
}

export interface ProjectFolder {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /**
   * Extra instructions this project adds to a column's on-enter prompt, keyed
   * by column id. Lives here so deleting the project takes them with it; see
   * `shared/board/projectColumnPrompts.ts` for how the two halves are composed.
   */
  columnPrompts?: Record<string, string>;
}

export interface ChangeSummary {
  files: number;
  additions: number;
  deletions: number;
}

export type ChangelogAuthor = 'user' | 'agent';

/** One reply in a changelog comment thread. */
export interface ChangelogReply {
  id: string;
  author: ChangelogAuthor;
  body: string;
  createdAt: number;
}

/**
 * A review note on a task's changelog (the Changes tab). Anchored to a file
 * and, when possible, a specific diff line. Local to the board.
 */
export interface ChangelogComment {
  id: string;
  path: string;
  /**
   * The folder the file is in, when the task works in more than one. Absent on
   * every note written before a task could span projects, which is why nothing
   * may require it: a note without one belongs to whichever folder shows it.
   */
  cwd?: string;
  /** Post-image line, when the note is on an added or context line. */
  newLine?: number;
  /** Pre-image line, when the note is on a deleted line. */
  oldLine?: number;
  side: 'add' | 'del' | 'ctx' | 'file';
  /** The diff line text as it was when the comment was left. */
  snippet: string;
  body: string;
  author: ChangelogAuthor;
  createdAt: number;
  /** Set when the thread has been marked done. */
  resolvedAt?: number;
  replies: ChangelogReply[];
}

/**
 * What a link points at. Drives the icon and the label — not behaviour: an
 * unrecognised URL is still a perfectly good link, it is just a 'link'.
 */
export type TaskLinkKind = 'jira' | 'pr' | 'issue' | 'commit' | 'doc' | 'link';

/** Who put the link on the task. */
export type TaskLinkSource = 'user' | 'agent' | 'prompt';

/**
 * Something outside the board that this task is about — the Jira ticket it
 * implements, the PR it produced, a design doc, a failing CI run.
 *
 * Lives on the task rather than in the transcript so it survives a new session:
 * the ticket is a property of the work, not of the conversation about it.
 */
export interface TaskLink {
  id: string;
  /** Absolute http(s) URL. The identity of the link — dedupe is by this. */
  url: string;
  title: string;
  kind: TaskLinkKind;
  /** Short human reference, e.g. `WEB-1234` or `owner/repo#9404`. */
  ref?: string;
  /** Why it is here, when that is not obvious from the title. */
  note?: string;
  /** 'prompt' means it was picked up from the text the task was created with. */
  source: TaskLinkSource;
  createdAt: number;
  updatedAt?: number;
  /**
   * Last answer from GitHub or Jira. Absent until a refresh has landed, and
   * absent is not "open" — a card must not look finished just because nobody
   * has asked yet.
   */
  status?: LinkStatus;
}

/**
 * Where a linked PR or ticket stands. `state` is the decision; `label` is the
 * words the tracker used ("In Review", "Merged").
 */
export interface LinkStatus {
  state: 'open' | 'draft' | 'merged' | 'closed' | 'done';
  label: string;
  /**
   * Where an open ticket sits in its workflow: not started, or being worked
   * on. From Jira's status category; absent for PRs and for statuses stored
   * before it was read.
   */
  stage?: 'todo' | 'active';
  checkedAt: number;
}

export type TaskSessionKind = 'main' | 'btw' | 'stage';

/** How a session was started, which is what the user actually reasons about. */
export type SessionOrigin =
  /** The task's first session. */
  | 'initial'
  /** A blank session started to continue the work with a clean context. */
  | 'new'
  /** A copy of another session, carrying its whole conversation. */
  | 'fork'
  /** Archived when a stage column demanded a fresh session. */
  | 'stage';

/** One column a session worked in, and when it entered. */
export interface SessionStageEntry {
  columnId: string;
  at: number;
}

/** A session linked to a task (e.g. main session, past stage session, or "BTW" side chat). */
/**
 * What the user picked for one session — the model, agent and thinking level
 * its turns are configured with. Held per session because a side chat started
 * on a different model must not drag the task's main conversation onto it.
 */
export interface SessionChoice {
  model?: string;
  agent?: string;
  thinkingLevel?: string;
}

export interface TaskSessionLink {
  sessionId: string;
  title: string;
  kind: TaskSessionKind;
  createdAt: number;
  updatedAt?: number;
  stageColumnId?: string;
  /**
   * Every column this session has worked in, oldest first, with the moment it
   * entered. A stage column that does not demand a fresh session leaves one
   * session spanning several stages; without this the spend breakdown bills all
   * of it to whichever column the session happened to start in.
   *
   * Absent on links written before stage history existed — those still report
   * as the single `stageColumnId` phase they always did.
   */
  stages?: SessionStageEntry[];
  prompt?: string;
  /**
   * What OpenCode last *ran* this session as, refreshed from its database. The
   * board's own pick is `chosen`; these two differ whenever the agent fell back
   * to something else, which is worth being able to see.
   */
  model?: string;
  agent?: string;
  thinkingLevel?: string;
  /**
   * What this session was told to run as. Every turn in it is configured with
   * this, falling back to the task's settings when the session never made a
   * pick of its own.
   */
  chosen?: SessionChoice;
  tokenCount?: number;
  cost?: number;
  /**
   * OpenCode session.cost copied at fork time. A fork's live cost includes the
   * parent conversation; billed spend is `cost - costAtFork`.
   */
  costAtFork?: number;
  lastUserMessage?: string;
  lastMessage?: string;
  logs?: TaskLogItem[];
  /**
   * Per-session run state. Sessions of one task run concurrently, so the task's
   * own `runState` is an aggregate of these rather than the source of truth.
   */
  runState?: TaskRunState;
  /** Set while this session's turn is blocked on the user. */
  pendingRequest?: PendingRequest;
  /** Prompts waiting for this session's current turn to finish, oldest first. */
  queued?: QueuedTurn[];
  /**
   * True when `logs` was stripped for transport. List and push payloads omit
   * transcripts; the drawer fetches them per task.
   */
  logsOmitted?: boolean;
  /** Session this one was copied from, when it was a fork. */
  forkedFrom?: string;
  /** How this session came to exist — drives the badge in the sessions list. */
  origin?: SessionOrigin;
  /** Working folder for this session when it is not the task's cwd. */
  cwd?: string;
  projectId?: string;
  projectName?: string;
  /** Last assistant turn occupancy for this session, not the task's primary. */
  contextTokens?: number;
  contextLimit?: number;
  /** Set when a stage transition retired this session; it stays readable. */
  archivedAt?: number;
  error?: string;
}

export interface BoardTask {
  id: string;
  title: string;
  /**
   * Set when the user types a title. OpenCode session renames only replace
   * titles that still look like the original prompt.
   */
  titleLocked?: boolean;
  description: string;
  prompt: string;
  /** User's original request. Column interpolations must never overwrite this. */
  originalPrompt?: string;
  /**
   * Images dropped into the composer the task was written in. They ride along
   * with the task's *first* turn — after that the conversation has seen them,
   * and a follow-up carries whatever was dropped into the follow-up.
   */
  promptImages?: PromptImage[];
  columnId: string;
  /** Last column whose on-enter prompt was actually sent. */
  lastRunColumnId?: string;
  runState: TaskRunState;
  model: string;
  agent: string;
  thinkingLevel: ThinkingLevel;
  sessionId?: string;
  /** Sessions linked to this task (main, previous stages, and side chats/btw). */
  sessions?: TaskSessionLink[];
  /** Currently selected/active session in the drawer when multiple exist. */
  activeSessionId?: string;
  cwd: string;
  projectId?: string;
  /** Overrides the board default for this task. */
  permissionMode?: PermissionMode;
  /** Set while the agent is blocked waiting for the user to answer. */
  pendingRequest?: PendingRequest;
  createdAt: number;
  updatedAt: number;
  /**
   * When the task was archived off the board. Absent means live — boards
   * written before archiving load with every task live and nothing to migrate.
   * See `shared/task/archive.ts`.
   */
  archivedAt?: number;
  logs: TaskLogItem[];
  /**
   * True when `logs` (and every `sessions[].logs`) were stripped for transport.
   * The board list and WebSocket snapshots are sent this way — a task's whole
   * transcript is megabytes, and re-sending it on every streamed log event was
   * the board's single biggest cost. Clients keep the transcript they already
   * hold when a stripped snapshot arrives, and fetch the full task on demand.
   */
  logsOmitted?: boolean;
  /**
   * Tool calls still pending or in progress. Set on stripped snapshots so the
   * background-tasks tab can show a running shell without the transcript.
   */
  activeTools?: ActiveToolCall[];
  /**
   * Prompts waiting on a running turn, across every live session of this task.
   * Aggregated from the sessions so the card can say "2 queued" without
   * knowing which session each one belongs to.
   */
  queued?: QueuedTurn[];
  pendingQuestion?: string;
  error?: string;
  lastMessage?: string;
  /** Most recent user_say, used on the card without opening the drawer. */
  lastUserMessage?: string;
  changeSummary?: ChangeSummary;
  tokenCount?: number;
  /** Estimated API USD across every linked session. Forks count only spend after the copy. */
  cost?: number;
  /** Child OpenCode sessions rolled into cost/tokenCount. */
  subagentCount?: number;
  /** Last assistant turn occupancy (input + cache + output). */
  contextTokens?: number;
  /** Context window OpenCode is using (opencode.json override, else catalog). */
  contextLimit?: number;
  cwdExists?: boolean;
  cwdDirty?: boolean;
  /** Live uncommitted paths in a worktree cwd. */
  cwdDirtyFiles?: string[];
  worktreeLabel?: string;
  isWorktree?: boolean;
  projectName?: string;
  /**
   * Local review notes on this task's changelog. Not posted to GitHub —
   * they live in board state so `/address comments` can attach them later.
   */
  changelogComments?: ChangelogComment[];
  /**
   * Tickets, PRs and other pages this task is about. Added by the user, by the
   * agent through the board's MCP tools, or lifted out of the creating prompt.
   */
  links?: TaskLink[];
}

/**
 * When the board is allowed to raise a desktop notification. The board exists
 * to be left alone while agents work, so the events worth interrupting for are
 * the ones that stall progress: a blocked agent, a finished turn, a failure.
 *
 * Optional on `GlobalSettings` — boards saved before notifications existed have
 * no such key, and fall back to `DEFAULT_NOTIFICATION_SETTINGS`.
 */
export interface NotificationSettings {
  /** Master switch. Stays false until the browser grants permission. */
  enabled: boolean;
  /** An agent is blocked on a permission request or a question. */
  awaitingInput: boolean;
  /** A turn finished on its own. */
  turnComplete: boolean;
  /** A turn failed. */
  error: boolean;
  /** Skip notifications while the board tab is focused. */
  onlyWhenUnfocused: boolean;
  /** Play a short tone alongside the notification. */
  sound: boolean;
}

export interface GlobalSettings {
  defaultModel: string;
  defaultAgent: string;
  defaultThinkingLevel: ThinkingLevel;
  defaultPermissionMode: PermissionMode;
  defaultCwd: string;
  selectedProjectId?: string;
  projects: ProjectFolder[];
  columns: BoardColumn[];
  /** Absent on boards saved before notifications existed. */
  notifications?: NotificationSettings;
  /**
   * Tools the board turns off — or back on — for every session it runs, by the
   * name the model sees (`bash`, `slack_*`, `*`). Applied as an OpenCode config
   * overlay on the agent process, so a blocked tool is missing from the model's
   * tool list rather than refused after it has already been called.
   */
  toolPolicy?: Record<string, boolean>;
}

export interface BoardState {
  tasks: BoardTask[];
  settings: GlobalSettings;
  /**
   * Monotonic counter backing human-readable TASK-nnn ids. Persisted so ids never
   * depend on the current task count (which made them collide after deletes).
   */
  nextTaskNumber: number;
}

/**
 * Server -> client push. A discriminated union so each variant carries exactly
 * the fields it needs: `task` is guaranteed present where it matters, and a
 * deletion is its own variant rather than "TASK_UPDATED with no task".
 */
export type WebSocketMessage =
  | { type: 'TASK_UPDATED'; taskId: string; task: BoardTask }
  | { type: 'TASK_DELETED'; taskId: string }
  | { type: 'TASK_LOG'; taskId: string; task: BoardTask; log: TaskLogItem }
  | { type: 'TASK_STATUS_CHANGED'; taskId: string; task: BoardTask; status: TaskRunState }
  | { type: 'ERROR'; taskId: string; task: BoardTask; message: string }
  | { type: 'TASK_AWAITING_INPUT'; taskId: string; task: BoardTask; request: PendingRequest }
  | { type: 'PROJECTS_UPDATED'; projects: ProjectFolder[] };

/** Variants that carry a full task snapshot the client should merge. */
export type TaskSnapshotMessage = Extract<WebSocketMessage, { task: BoardTask }>;
