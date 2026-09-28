import {
  PendingPermission,
  PendingQuestion,
  PendingRequest,
  PermissionAnswer,
  PermissionMode,
  QuestionField,
  ToolCallInfo
} from '../../shared/types.js';
import {
  autoDecision,
  DEFAULT_PERMISSION_MODE,
  isAccessWithinFolder,
  pickAutoApproveOption,
  pickRejectOption,
  sortPermissionOptions
} from '../../shared/agent/permissions.js';
import { normalizeToolStatus, toolLabel } from '../../shared/agent/toolCall.js';
import { newId } from '../../shared/ids.js';
import { httpUrl } from '../../shared/task/links.js';
import {
  ElicitationParams,
  extractToolOutput,
  JsonRpcId,
  permissionToolCallFrom,
  RequestPermissionParams
} from './schema.js';
import { AcpEvent, autoApproved } from './events.js';

/** A request the agent is blocked on until somebody answers it. */
interface ParkedRequest {
  taskId: string;
  sessionId?: string;
  jsonRpcId: JsonRpcId;
  request: PendingRequest;
}

export interface ApprovalDeps {
  /** Answer the agent's JSON-RPC request. */
  respond(id: JsonRpcId, result: unknown): void;
  /** Tell the board. No-op when nothing is listening yet. */
  emit(taskId: string, event: AcpEvent): void;
  /** The folder the board runs a task's session in, when it knows one. */
  folderFor?(taskId: string, sessionId: string): string | undefined;
  /** What the session's updates already said about a tool call. */
  knownToolCall?(taskId: string, toolCallId: string): ToolCallInfo | undefined;
}

/**
 * OpenCode 1.14 asks with an empty `rawInput` and sends the arguments on the
 * `in_progress` update just before the request. Borrow them from there, so the
 * prompt shows the command and the folder rule can see the paths.
 */
export function withKnownInput(toolCall: ToolCallInfo, known: ToolCallInfo | undefined): ToolCallInfo {
  if (!known) return toolCall;
  const hasInput = !!toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0;
  return {
    ...toolCall,
    rawInput: hasInput ? toolCall.rawInput : known.rawInput ?? toolCall.rawInput,
    locations: toolCall.locations?.length ? toolCall.locations : known.locations ?? toolCall.locations
  };
}

/** The tool call a permission request is about, in the board's own shape. */
export function toolCallFromPermission(params: RequestPermissionParams): ToolCallInfo {
  const raw = permissionToolCallFrom(params);
  return {
    toolCallId: raw.toolCallId,
    name: toolLabel(raw.name || raw.title || params.title, raw.kind),
    kind: raw.kind ?? undefined,
    status: normalizeToolStatus(raw.status) ?? 'pending',
    rawInput: raw.rawInput,
    output: extractToolOutput(raw.content),
    locations: raw.locations?.map((l) => l.path).filter((p): p is string => !!p)
  };
}

/** The typed form an `elicitation/create` schema describes. */
export function questionFieldsFrom(params: ElicitationParams): QuestionField[] {
  const properties = params.requestedSchema?.properties ?? {};
  const required = new Set(params.requestedSchema?.required ?? []);
  return Object.entries(properties).map(([name, field]) => ({
    name,
    type: field.type ?? 'string',
    title: field.title ?? undefined,
    description: field.description ?? undefined,
    required: required.has(name),
    options: field.enum ?? field.items?.enum,
    default: field.default ?? undefined
  }));
}

/**
 * Everything the agent is blocked on, and the rules for answering it.
 *
 * A parked request holds a JSON-RPC id open, so the one thing this must never
 * do is lose track of one: an unanswered request hangs the agent's turn for as
 * long as the process lives.
 */
export class ApprovalDesk {
  /** requestId -> the JSON-RPC request the agent is blocked on. */
  private readonly parked = new Map<string, ParkedRequest>();
  private readonly modes = new Map<string, PermissionMode>();

  constructor(private readonly deps: ApprovalDeps) {}

  // --- permission modes ---

  modeFor(taskId: string): PermissionMode {
    return this.modes.get(taskId) ?? DEFAULT_PERMISSION_MODE;
  }

  /** The server pushes the effective mode before each turn starts. */
  setMode(taskId: string, mode: PermissionMode): void {
    this.modes.set(taskId, mode);
  }

  clearMode(taskId: string): void {
    this.modes.delete(taskId);
  }

  // --- incoming requests ---

  /**
   * `taskId` is undefined when no task owns the session — a stray request, or
   * one for a task that was already deleted. Rejecting is the safe answer when
   * there is nobody left to ask.
   */
  onPermissionRequest(id: JsonRpcId, params: RequestPermissionParams, taskId: string | undefined): void {
    if (!taskId) {
      this.respondToPermission(id, pickRejectOption(params.options));
      return;
    }
    const asked = toolCallFromPermission(params);
    const toolCall = withKnownInput(asked, this.deps.knownToolCall?.(taskId, asked.toolCallId));

    const mode = this.modeFor(taskId);
    const ownFolder = mode !== 'manual'
      && isAccessWithinFolder(toolCall, this.deps.folderFor?.(taskId, params.sessionId));
    if (ownFolder || autoDecision(mode, toolCall) === 'approve') {
      const approve = pickAutoApproveOption(params.options);
      if (approve) {
        this.deps.emit(taskId, autoApproved(toolCall.name, mode));
        this.respondToPermission(id, approve);
        return;
      }
    }

    const pending: PendingPermission = {
      type: 'permission',
      requestId: newId(),
      askedAt: Date.now(),
      toolCall,
      options: sortPermissionOptions(params.options)
    };
    this.park({ taskId, sessionId: params.sessionId, jsonRpcId: id, request: pending });
  }

  /** Elicitations arrive without a session, so the caller attributes them. */
  onElicitation(
    id: JsonRpcId,
    params: ElicitationParams,
    taskId: string | undefined,
    sessionId: string | undefined
  ): void {
    if (!taskId) {
      this.deps.respond(id, { action: 'cancel' });
      return;
    }

    const pending: PendingQuestion = {
      type: 'question',
      requestId: newId(),
      askedAt: Date.now(),
      message: params.message,
      mode: params.mode,
      // The agent picks this link and the board renders it as one: http(s) only.
      url: httpUrl(params.url),
      fields: questionFieldsFrom(params)
    };
    this.park({ taskId, sessionId, jsonRpcId: id, request: pending });
  }

  /**
   * Holds the JSON-RPC id open and tells the board a human is needed.
   *
   * The board shows one request per session, but an agent running tools in
   * parallel (a read and a grep outside the working folder) parks several. What
   * goes out is the *head* of that session's queue, not necessarily the one
   * that just arrived: announcing a newer one would replace the older on screen,
   * and the one nobody can see any more hangs the turn. The rest are surfaced
   * one by one as each is answered — see the respond route.
   *
   * The head is re-announced rather than the emit being skipped, so a board
   * whose slot was cleared behind the desk's back (a reload, a run-state write
   * that wiped it) is put right by the next request instead of going quiet with
   * the agent blocked on something nobody can see.
   */
  private park(entry: ParkedRequest): void {
    this.parked.set(entry.request.requestId, entry);
    const head = this.headFor(entry.taskId, entry.sessionId) ?? entry;
    this.deps.emit(head.taskId, {
      type: 'awaiting_input',
      request: head.request,
      sessionId: head.sessionId
    });
  }

  // --- answering ---

  /** The session a parked request belongs to, so the caller can clear its state. */
  sessionForRequest(requestId: string): string | undefined {
    return this.parked.get(requestId)?.sessionId;
  }

  /** Answers a parked request. False when it is unknown or already answered. */
  resolve(answer: PermissionAnswer): boolean {
    const entry = this.parked.get(answer.requestId);
    if (!entry) return false;
    this.parked.delete(answer.requestId);

    if (answer.kind === 'permission') {
      this.respondToPermission(entry.jsonRpcId, answer.optionId);
    } else if (answer.action === 'accept') {
      this.deps.respond(entry.jsonRpcId, { action: 'accept', content: answer.content });
    } else {
      this.deps.respond(entry.jsonRpcId, { action: answer.action });
    }
    return true;
  }

  /** The oldest request still parked for a task (or one of its sessions). */
  requestFor(taskId: string, sessionId?: string): PendingRequest | undefined {
    return this.headFor(taskId, sessionId)?.request;
  }

  /** The oldest parked entry for a task (or one of its sessions). */
  private headFor(taskId: string, sessionId?: string): ParkedRequest | undefined {
    for (const entry of this.parked.values()) {
      if (entry.taskId !== taskId) continue;
      if (sessionId && entry.sessionId !== sessionId) continue;
      return entry;
    }
    return undefined;
  }

  /**
   * Answers everything still parked for a task — used when the turn is
   * cancelled, so the agent is never left blocked on a request nobody can see.
   */
  cancelAll(taskId: string, sessionId?: string): void {
    for (const [requestId, entry] of [...this.parked.entries()]) {
      if (entry.taskId !== taskId) continue;
      // Stopping one fork must not answer a request the main session is blocked
      // on — that would silently cancel a tool call the user never touched.
      if (sessionId && entry.sessionId && entry.sessionId !== sessionId) continue;
      this.parked.delete(requestId);
      if (entry.request.type === 'permission') {
        this.deps.respond(entry.jsonRpcId, { outcome: { outcome: 'cancelled' } });
      } else {
        this.deps.respond(entry.jsonRpcId, { action: 'cancel' });
      }
    }
  }

  /**
   * Forget everything parked, without answering any of it: the agent process
   * that asked is gone, and its JSON-RPC ids died with it.
   *
   * Keeping them would be worse than losing them. A request nobody can answer
   * stays at the head of its session's queue for the life of the board, and
   * every request the restarted agent makes queues behind it unseen — the agent
   * blocks on a read outside its folder and the board never asks.
   */
  dropAll(): void {
    this.parked.clear();
  }

  private respondToPermission(jsonRpcId: JsonRpcId, optionId: string | undefined): void {
    this.deps.respond(
      jsonRpcId,
      optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
    );
  }
}
