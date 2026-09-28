import { api, MoveTargetInput, StartSessionInput } from '../../api';
import { notifySuccess, reportError } from '../../app/notify';
import { BoardTask, PromptImage } from '../../../shared/types';
import { listTaskSessions } from '../../../shared/task/sessions';
import { SessionChoice } from '../../../shared/types';
import { PendingPrompts } from './usePendingPrompts';

/**
 * Everything the drawer asks the server to do, in one place.
 *
 * These are plain closures rather than a hook: they own no state of their own,
 * they only need the task, the session on screen, and somewhere to put the
 * result. Keeping them out of the component leaves it to decide what is shown.
 */

export interface DrawerActionContext {
  task: BoardTask;
  /** The session on screen — what every action below acts on. */
  sessionId?: string;
  cwd: string;
  /** Show a session in the drawer. Undefined selects the task's own again. */
  onViewSession: (sessionId: string | undefined) => void;
  onClearComposer: () => void;
  setCompacting: (value: boolean) => void;
  /** Resolves false when the server refused the prompt. */
  onSendPrompt: (taskId: string, prompt: string, images?: PromptImage[]) => Promise<boolean>;
  /** The session on screen is mid-turn, so a prompt sent now is queued. */
  busy: boolean;
  pending: PendingPrompts;
  onStopSession: (taskId: string, sessionId: string) => void | Promise<void>;
  onStopTask: (taskId: string) => void | Promise<void>;
}

export interface DrawerActions {
  sendPrompt: (prompt: string, images?: PromptImage[]) => Promise<void>;
  startSession: (data: StartSessionInput) => Promise<void>;
  /**
   * Carry the work on in a blank session, at once: where the main session
   * runs, on what the task runs as. The dialog is only for a fork, which needs
   * a question, or for a blank session started somewhere else.
   */
  startNewSession: () => Promise<void>;
  /**
   * Run the session on screen as this. Only for a side session — the task's own
   * conversation is configured by the task itself.
   */
  setSessionSettings: (settings: SessionChoice) => void;
  selectSession: (sessionId: string) => void;
  promoteSession: (sessionId: string) => void;
  /**
   * Move the work: one session when given an id, the whole task otherwise. An
   * empty target detaches it — the task from its project, a session back onto
   * the task's.
   */
  moveWork: (sessionId: string | undefined, target: MoveTargetInput) => Promise<boolean>;
  removeQueued: (queuedId: string) => void;
  stopSession: (sessionId: string) => void;
  /** Stop the session on screen, or the whole task when it has none. */
  stop: () => void;
  compact: () => void;
  /**
   * Open a file in an editor. `baseCwd` is the folder the path is relative to —
   * a task can work in several, and a file from another one resolved against
   * the session's folder would point at nothing.
   */
  openPath: (editor: string, relativePath?: string, line?: number, baseCwd?: string) => void;
}

export function drawerActions(ctx: DrawerActionContext): DrawerActions {
  const { task, sessionId } = ctx;
  const isLinked = (id: string | undefined): id is string =>
    !!id && listTaskSessions(task).some((s) => s.sessionId === id);

  const actions: DrawerActions = {
    /** `prompt` is what the composer built: the typed text plus any fetched blocks. */
    async sendPrompt(prompt, images) {
      const text = prompt.trim();
      // An image on its own is a turn; a subagent transcript has no session to
      // send either to.
      if ((!text && !images?.length) || (sessionId && !isLinked(sessionId))) return;
      ctx.onClearComposer();
      // Shown at once, not when the agent gets round to echoing it. A busy
      // session queues it instead, and the queue above the composer says so.
      const pendingId = ctx.busy ? undefined : ctx.pending.add(text, images);

      let sent: boolean;
      if (sessionId && sessionId !== task.sessionId) {
        try {
          await api.promptSession(task.id, sessionId, text, images);
          sent = true;
        } catch (err) {
          reportError('Could not send prompt to side chat', err);
          sent = false;
        }
      } else {
        sent = await ctx.onSendPrompt(task.id, text, images);
      }
      if (!sent && pendingId) ctx.pending.remove(pendingId);
    },

    async startSession(data) {
      const isFork = data.mode === 'fork';
      try {
        const updated = await api.startSession(task.id, {
          ...data,
          // Fork what is on screen, falling back to the task's own session.
          sourceSessionId: isFork ? (isLinked(sessionId) ? sessionId : task.sessionId) : undefined
        });
        // The session appearing in the list and on screen says it started. A
        // blank one is linked a moment after this answer, as the task's main
        // session, so the drawer follows the task's own rather than pinning
        // the one this answer still names.
        ctx.onViewSession(isFork ? updated.activeSessionId : undefined);
      } catch (e) {
        reportError(isFork ? 'Could not fork this session' : 'Could not start a new session', e);
      }
    },

    async startNewSession() {
      const main = listTaskSessions(task).find((s) => s.sessionId === task.sessionId);
      // No model, agent or level: a session that sends none follows the task's.
      await actions.startSession({ mode: 'new', cwd: main?.cwd, projectId: main?.projectId });
    },

    setSessionSettings(settings) {
      if (!isLinked(sessionId)) return;
      api
        .setSessionSettings(task.id, sessionId, settings)
        .catch((e) => reportError('Could not change what this session runs as', e));
    },

    selectSession(id) {
      ctx.onViewSession(id);
      // Subagent sessions are not the task's to switch to; they are only read.
      if (isLinked(id)) void api.switchSession(task.id, id).catch(() => {});
    },

    promoteSession(id) {
      api
        .promoteSession(task.id, id)
        .then(() => notifySuccess('Main session changed', 'Follow-ups and column runs now go here'))
        .catch((e) => reportError('Could not switch the main session', e));
    },

    /**
     * A project is a folder, so this decides where the next turn runs. The
     * server's own log line is the message: it knows whether the checkout
     * changed, and whether a running turn will only feel it on the next one.
     */
    async moveWork(id, target) {
      try {
        const updated = id
          ? await api.moveSessionToProject(task.id, id, target)
          : await api.moveTaskToProject(task.id, target);
        notifySuccess(
          id ? 'Session moved' : 'Task moved',
          updated.move?.log || `${task.id} already runs there`
        );
        return true;
      } catch (e) {
        reportError(id ? 'Could not move this session' : 'Could not move this task', e);
        // The dialog stays open on a refusal, so the target can be changed.
        return false;
      }
    },

    removeQueued(queuedId) {
      api
        .removeQueuedTurn(task.id, queuedId)
        .then(() => notifySuccess('Prompt removed', 'It will not be sent when this turn finishes'))
        .catch((e) => reportError('Could not remove that queued prompt', e));
    },

    stopSession(id) {
      void ctx.onStopSession(task.id, id);
    },

    stop() {
      // A turn stopped while warming up never echoes its prompt.
      ctx.pending.clearSession(sessionId);
      if (sessionId) void ctx.onStopSession(task.id, sessionId);
      else void ctx.onStopTask(task.id);
    },

    // Compaction runs as a turn; the resulting state arrives over the WebSocket,
    // so this only has to cover the request itself.
    compact() {
      // Only a session of this task can be compacted — never a subagent's.
      if (!isLinked(sessionId)) return;
      ctx.setCompacting(true);
      api
        .compactSession(task.id, sessionId)
        .then(() => notifySuccess('Compacting', `Summarizing this session in ${task.id} to free up context`))
        .catch((e) => reportError('Could not compact this session', e))
        .finally(() => ctx.setCompacting(false));
    },

    openPath(editor, relativePath, line, baseCwd) {
      const base = (baseCwd || ctx.cwd).replace(/\/+$/, '');
      // A diff can name a file by an absolute path; gluing that onto the base
      // makes a path that exists nowhere.
      const target = !relativePath
        ? base
        : relativePath.startsWith('/')
          ? relativePath
          : `${base}/${relativePath}`;
      void api
        .openIn(editor, target, line, task.id)
        .catch((e) => reportError('Could not open that path', e));
    }
  };
  return actions;
}
