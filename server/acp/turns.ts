import { BoardTask, PromptImage, SessionChoice } from '../../shared/types.js';
import { listTaskSessions } from '../../shared/task/sessions.js';
import { promptBlocks } from '../../shared/composer/promptImages.js';
import { imageKeepBudget, parseImageLimitError } from '../../shared/sessions/imageLimit.js';
import { loadImageData } from '../board/attachments.js';
import { cloneSessionWithoutExcessImages } from '../opencode/clone.js';
import { ConfigOption, promptResultSchema, sessionResultSchema } from './schema.js';
import { boardMcpServer } from '../mcp/boardMcp.js';
import {
  AcpEvent,
  compactFailed,
  compactFinished,
  compactStarted,
  configWarning,
  promptEcho,
  promptEchoTitle,
  sessionBound,
  sessionRecovered,
  turnFailed,
  turnFinished,
  turnSuperseded
} from './events.js';
import { SessionConfigurator } from './sessionConfig.js';
import { AcpSessionRegistry } from './sessionRegistry.js';
import { SessionLifecycle } from './sessions.js';
import { AcpTransport, NO_TIMEOUT } from './transport.js';

/**
 * OpenCode's own slash command for summarizing the conversation so far. There is
 * no ACP capability for compaction — verified against `initialize`, which
 * advertises only close/fork/list/resume — so it travels as an ordinary prompt
 * turn and OpenCode's slash-command handling turns it into a `compaction` part.
 */
const COMPACT_COMMAND = '/compact';

/**
 * How long a new prompt waits for a cancelled one to unwind. OpenCode rejects
 * a `session/prompt` while the session's previous one has not returned
 * ("Session already has an active ACP prompt"), and `session/cancel` is only a
 * notification — the old prompt answers when OpenCode gets round to it.
 */
const PREVIOUS_PROMPT_WAIT_MS = 15_000;

export interface StartTurnOptions {
  reconfigure?: boolean;
  /** What this turn's session should run as, when it is not the task's settings. */
  chosen?: SessionChoice;
  /** Images the composer attached to this prompt. */
  images?: PromptImage[];
  sessionId?: string;
  newSession?: boolean;
  primary?: boolean;
  isBtw?: boolean;
  title?: string;
  cwd?: string;
  /** Open and configure the session, then stop: no prompt, no turn. */
  openOnly?: boolean;
}

interface RecoveryContext {
  isPrimary: boolean;
  chosen?: SessionChoice;
  cwd: string;
}

function messageOf(e: unknown): string {
  return (e as { message?: string } | undefined)?.message || String(e);
}

/**
 * Running a turn: which session it happens in, what settings it runs under,
 * and how it ends.
 *
 * Every turn claims a generation before it starts. A stop or a newer turn bumps
 * it, so a reply that arrives late can tell it has been superseded and stay
 * quiet instead of overwriting a story somebody else already told.
 */
export class TurnRunner {
  /** The `session/prompt` each session last sent, until it has returned. */
  private readonly outstanding = new Map<string, Promise<unknown>>();

  constructor(
    private readonly transport: AcpTransport,
    private readonly registry: AcpSessionRegistry,
    private readonly config: SessionConfigurator,
    private readonly sessions: SessionLifecycle,
    private readonly emit: (taskId: string, event: AcpEvent) => void
  ) {}

  /**
   * Start (or continue) a turn in one specific session.
   *
   * `options.sessionId` targets an existing session — including a fork that so
   * far only exists as rows in OpenCode's database, which is why it is always
   * `session/load`ed rather than assumed to be live. `options.newSession` asks
   * for a blank one. With neither, the task's primary session is used, and one
   * is created if it has none.
   */
  async start(task: BoardTask, promptMessage?: string, options?: StartTurnOptions): Promise<string> {
    const cwd = options?.cwd || task.cwd || process.cwd();
    const target = this.chooseSession(task, options);
    if (target.sessionId && this.registry.isInFlight(target.sessionId)) {
      throw new Error('A turn is already running in this session');
    }

    const opened = target.sessionId
      ? await this.attach(task, target.sessionId, cwd, target.makePrimary)
      : await this.open(task, cwd, target.makePrimary);
    const { sessionId, isNew } = opened;

    const generation = this.registry.nextGeneration(sessionId);
    // Every turn, not only a new session: the composer is the source of truth
    // for model/agent/thinking, and a follow-up that skipped this is how a
    // Kimi selection kept running as Opus. The session's own pick wins over the
    // task's, so a follow-up in a fork does not drag it onto the task's model.
    const chosen = options?.chosen
      ?? listTaskSessions(task).find((link) => link.sessionId === sessionId)?.chosen;
    try {
      await this.config.applyTo(task, sessionId, opened.options, chosen);
    } catch (e) {
      this.warnConfig(task.id, `Failed to apply session configuration: ${messageOf(e)}`);
    }
    if (!this.registry.isCurrentGeneration(sessionId, generation)) return sessionId;
    // A blank session the user opened to type into: sending the task's prompt
    // here would restart the work they asked to leave behind.
    if (options?.openOnly) return sessionId;

    const prompt = promptMessage || (isNew ? (task.prompt || task.description || task.title) : 'Continue.');
    const images = options?.images || [];
    this.emit(task.id, promptEcho(sessionId, promptEchoTitle(!!promptMessage, !!options?.isBtw, isNew), prompt, images));
    this.dispatch(task, sessionId, prompt, generation, images, {
      isPrimary: target.makePrimary,
      chosen,
      cwd
    });
    return sessionId;
  }

  /**
   * Summarize the conversation so the session can continue with a smaller
   * context. Unlike `start` this awaits the whole turn, so callers (a column's
   * compact-on-enter) can sequence the column prompt after it.
   *
   * Never creates a session: compacting a task that has never run is meaningless.
   */
  async compact(task: BoardTask, targetSessionId?: string): Promise<void> {
    // Resolved synchronously: the session id is the in-flight key, so it has to
    // be known before the first await or a turn dispatched in the same tick
    // could slip onto ACP stdin alongside this one.
    const sessionId = targetSessionId || this.registry.primaryOf(task.id) || task.sessionId;
    if (!sessionId) throw new Error('This task has no OpenCode session to compact yet');
    if (this.registry.isInFlight(sessionId)) throw new Error('A turn is already running in this session');

    this.registry.clearCancelled(sessionId);
    this.registry.markInFlight(sessionId);
    this.registry.bind(sessionId, task.id);
    const generation = this.registry.nextGeneration(sessionId);

    const cwd = task.cwd || process.cwd();
    const isPrimary = sessionId === (this.registry.primaryOf(task.id) || task.sessionId);
    const chosen = listTaskSessions(task).find((link) => link.sessionId === sessionId)?.chosen;
    const context: RecoveryContext = { isPrimary, chosen, cwd };

    let activeSessionId = sessionId;
    let activeGeneration = generation;
    const startedAt = Date.now();

    try {
      if (!this.registry.isLoaded(sessionId)) {
        await this.sessions.importSession(task.id, sessionId, cwd, {
          replayLogs: false,
          primary: sessionId === task.sessionId
        });
      }
      this.emit(task.id, compactStarted(sessionId, COMPACT_COMMAND));

      let res: unknown;
      try {
        res = await this.sendPrompt(sessionId, [{ type: 'text', text: COMPACT_COMMAND }]);
      } catch (err) {
        const recovered = await this.recoverImageLimitedSession(
          task,
          sessionId,
          generation,
          err,
          0,
          startedAt,
          COMPACT_COMMAND,
          context
        );
        if (!recovered) throw err;
        activeSessionId = recovered.sessionId;
        activeGeneration = recovered.generation;
        res = await this.sendPrompt(activeSessionId, [{ type: 'text', text: COMPACT_COMMAND }]);
      }
      if (this.settle(task.id, activeSessionId, activeGeneration)) return;

      const stopReason = promptResultSchema.safeParse(res).data?.stopReason || 'end_turn';
      console.log(`[ACP] Task ${task.id} compact finished:`, stopReason);
      this.emit(task.id, compactFinished(activeSessionId, stopReason));
    } catch (err) {
      if (this.settle(task.id, activeSessionId, activeGeneration)) return;
      console.error(`[ACP] Task ${task.id} compact error:`, err);
      this.emit(task.id, compactFailed(activeSessionId, err));
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Which session this turn runs in, and whether it becomes the task's primary
   * — the target of plain follow-ups and column auto-runs. Forks pass false.
   */
  private chooseSession(task: BoardTask, options?: StartTurnOptions): {
    sessionId?: string;
    makePrimary: boolean;
  } {
    const requested = options?.sessionId;
    const wantsNew = !!options?.newSession && !requested;
    const sessionId = wantsNew ? undefined : (requested || this.registry.primaryOf(task.id) || task.sessionId);
    const makePrimary = options?.primary
      ?? (!options?.isBtw && (!task.sessionId || sessionId === task.sessionId || wantsNew));
    return { sessionId, makePrimary };
  }

  /** Make an existing session ready to prompt, loading it if this process has not. */
  private async attach(
    task: BoardTask,
    sessionId: string,
    cwd: string,
    makePrimary: boolean
  ): Promise<{ sessionId: string; isNew: false; options: ConfigOption[] }> {
    if (!this.registry.isLoaded(sessionId)) {
      // Replay history into the transcript only when the board has none for
      // this task yet; otherwise the import would duplicate what it shows.
      const hadLogs = task.logs.some(
        (l) => l.type === 'user_say' || l.type === 'agent_say' || l.type === 'tool_call'
      );
      await this.sessions.importSession(task.id, sessionId, cwd, {
        replayLogs: !hadLogs && sessionId === task.sessionId,
        primary: makePrimary
      });
    } else if (makePrimary) {
      this.registry.setPrimary(task.id, sessionId);
    }
    this.registry.bind(sessionId, task.id);
    return { sessionId, isNew: false, options: this.registry.configOptions(sessionId) ?? [] };
  }

  private async open(
    task: BoardTask,
    cwd: string,
    makePrimary: boolean
  ): Promise<{ sessionId: string; isNew: true; options: ConfigOption[] }> {
    const res = sessionResultSchema.parse(
      await this.transport.request('session/new', { cwd, mcpServers: [boardMcpServer(task.id)] })
    );
    const sessionId = res.sessionId;
    if (!sessionId) throw new Error('Failed to create ACP session from opencode acp');

    const options = res.configOptions ?? [];
    if (makePrimary) this.registry.setPrimary(task.id, sessionId);
    this.registry.bind(sessionId, task.id);
    this.registry.setConfigOptions(sessionId, options);
    this.emit(task.id, sessionBound(sessionId, makePrimary));
    return { sessionId, isNew: true, options };
  }

  /**
   * Send the prompt and report how it ends. Deliberately not awaited: a turn
   * runs for minutes, and the caller needs the session id back now so the board
   * can show the task as running.
   */
  private dispatch(
    task: BoardTask,
    sessionId: string,
    text: string,
    generation: number,
    images: PromptImage[] = [],
    context: RecoveryContext
  ): void {
    this.registry.clearCancelled(sessionId);
    // Nothing from an earlier turn can still be waiting for an answer, and a
    // leftover would sit at the head of this session's queue and swallow every
    // request this turn makes.
    this.sessions.releaseParkedRequests(task.id, sessionId);
    this.registry.markInFlight(sessionId);

    // The bytes are read here and nowhere else: a queued turn waits as a list
    // of filenames, not as megabytes of base64 held for however long the turn
    // in front of it takes.
    const loadedImages = loadImageData(images);
    const prompt = promptBlocks(text, loadedImages);
    void this.runPromptTurn(task, sessionId, generation, prompt, text, loadedImages.length, context, false);
  }

  private async runPromptTurn(
    task: BoardTask,
    sessionId: string,
    generation: number,
    prompt: unknown[],
    promptText: string,
    newImageCount: number,
    context: RecoveryContext,
    retried: boolean
  ): Promise<void> {
    const turnStartedAt = Date.now();
    try {
      const res = await this.sendPrompt(sessionId, prompt);
      if (this.settle(task.id, sessionId, generation)) return;
      const stopReason = promptResultSchema.safeParse(res).data?.stopReason || 'end_turn';
      console.log(`[ACP] Task ${task.id} prompt finished:`, stopReason);
      this.emit(task.id, turnFinished(sessionId, stopReason));
    } catch (err) {
      if (!retried) {
        const recovered = await this.recoverImageLimitedSession(
          task,
          sessionId,
          generation,
          err,
          newImageCount,
          turnStartedAt,
          promptText,
          context
        );
        if (recovered) {
          await this.runPromptTurn(
            task,
            recovered.sessionId,
            recovered.generation,
            prompt,
            promptText,
            newImageCount,
            context,
            true
          );
          return;
        }
      }
      if (this.settle(task.id, sessionId, generation)) return;
      const message = this.formatTurnError(err, newImageCount);
      console.error(`[ACP] Task ${task.id} prompt execution error:`, err);
      this.emit(task.id, turnFailed(sessionId, message));
    }
  }

  /**
   * Recover automatically when a model rejects a turn for having too many
   * accumulated images in session history: fork a clean copy of the OpenCode
   * session keeping only the newest images inside budget, load it, and let the
   * caller retry once cleanly.
   */
  private async recoverImageLimitedSession(
    task: BoardTask,
    sessionId: string,
    generation: number,
    err: unknown,
    newImageCount: number,
    turnStartedAt: number,
    retryPromptText: string,
    context: RecoveryContext
  ): Promise<{ sessionId: string; generation: number } | null> {
    const rawMessage = messageOf(err);
    const limit = parseImageLimitError(rawMessage);
    if (!limit) return null;
    if (!this.registry.isCurrentGeneration(sessionId, generation) || this.registry.isCancelled(sessionId)) {
      return null;
    }
    if (limit.maxAllowed !== undefined && newImageCount > limit.maxAllowed) {
      return null;
    }

    const keepBudget = imageKeepBudget(limit.maxAllowed, newImageCount);
    const cloned = cloneSessionWithoutExcessImages(sessionId, undefined, {
      keepImages: keepBudget,
      dropSinceMs: turnStartedAt - 2_000,
      retryPromptText
    });
    if (!cloned || cloned.removedImages === 0) return null;

    if (this.registry.isCancelled(sessionId) || !this.registry.isCurrentGeneration(sessionId, generation)) {
      return null;
    }

    const nextGen = this.registry.nextGeneration(cloned.sessionId);
    this.registry.clearCancelled(cloned.sessionId);
    this.registry.markInFlight(cloned.sessionId);
    this.registry.bind(cloned.sessionId, task.id);

    try {
      await this.sessions.importSession(task.id, cloned.sessionId, context.cwd, {
        replayLogs: false,
        primary: context.isPrimary
      });
      if (context.chosen) {
        const configOptions = this.registry.configOptions(cloned.sessionId) ?? [];
        await this.config.applyTo(task, cloned.sessionId, configOptions, context.chosen).catch(() => undefined);
      }
    } catch (loadErr) {
      this.registry.clearInFlight(cloned.sessionId);
      console.warn(`[ACP] Could not load trimmed recovery session ${cloned.sessionId}:`, loadErr);
      return null;
    }

    if (this.registry.isCancelled(sessionId) || !this.registry.isCurrentGeneration(sessionId, generation)) {
      this.registry.clearInFlight(cloned.sessionId);
      return null;
    }

    this.sessions.releaseParkedRequests(task.id, sessionId);
    this.registry.clearInFlight(sessionId);

    this.emit(
      task.id,
      sessionRecovered({
        previousSessionId: sessionId,
        sessionId: cloned.sessionId,
        primary: context.isPrimary,
        costAtFork: cloned.costAtFork,
        chosen: context.chosen,
        removedImages: cloned.removedImages,
        keptImages: cloned.keptImages,
        model: limit.model,
        maxAllowed: limit.maxAllowed
      })
    );

    return { sessionId: cloned.sessionId, generation: nextGen };
  }

  private formatTurnError(err: unknown, newImageCount: number): string {
    const raw = messageOf(err);
    const limit = parseImageLimitError(raw);
    if (!limit) return raw;
    if (limit.maxAllowed !== undefined && newImageCount > limit.maxAllowed) {
      return `Too many images attached (${newImageCount}): ${limit.model || 'this model'} allows at most ${limit.maxAllowed} per request.`;
    }
    return `${raw} — open Sessions and start a blank new session (or retry without older images) to continue.`;
  }

  /**
   * Send `session/prompt` once the session's previous one has returned. A
   * stopped turn is released on the board at once, but OpenCode keeps it
   * active until its prompt answers; sending over it fails the new turn.
   * If it still has not answered in time, cancel it again and send anyway —
   * a hung agent must not hold the session forever.
   */
  private async sendPrompt(sessionId: string, prompt: unknown[]): Promise<unknown> {
    const previous = this.outstanding.get(sessionId);
    if (previous) {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        previous.then(() => false, () => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), PREVIOUS_PROMPT_WAIT_MS); })
      ]);
      clearTimeout(timer);
      if (timedOut) {
        console.warn(`[ACP] ${sessionId}: previous prompt still active, cancelling it again`);
        this.transport.notify('session/cancel', { sessionId });
      }
    }
    const request = this.transport.request('session/prompt', { sessionId, prompt }, NO_TIMEOUT);
    this.outstanding.set(sessionId, request);
    const forget = () => { if (this.outstanding.get(sessionId) === request) this.outstanding.delete(sessionId); };
    request.then(forget, forget);
    return request;
  }

  /**
   * Release the turn, and report whether it was already superseded — by a stop,
   * or by a newer turn — in which case the caller must stay quiet and leave the
   * story to whoever superseded it.
   *
   * Released before the event goes out, so a queued turn drained by the status
   * change is not bounced straight back onto the queue.
   */
  private settle(taskId: string, sessionId: string, generation: number): boolean {
    if (this.registry.isCurrentGeneration(sessionId, generation)) {
      this.registry.clearInFlight(sessionId);
      // The turn is over, so anything it left parked is dead — an agent that
      // was still waiting for an answer would not have returned from the
      // prompt. Only for the turn that is still the current one: a superseded
      // turn settling late must not answer the requests of the turn that
      // replaced it.
      this.sessions.releaseParkedRequests(taskId, sessionId);
      this.sessions.turnSettled(taskId, sessionId);
      return false;
    }
    // A superseded turn answering late must not free the session under the
    // turn that replaced it — its cancel already released this one. Nor may it
    // report the session as settled: the board idles it and drains its queue
    // on that, under a turn that is still running. Only a stop with nothing
    // after it needs the refresh.
    if (!this.registry.isInFlight(sessionId)) this.emit(taskId, turnSuperseded(sessionId));
    return true;
  }

  private warnConfig(taskId: string, text: string): void {
    console.warn(`[ACP] ${taskId}: ${text}`);
    this.emit(taskId, configWarning(text));
  }
}
