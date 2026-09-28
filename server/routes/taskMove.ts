import { Express, Request, Response } from 'express';
import { columnEnterActions, findColumn } from '../../shared/board/columns.js';
import { resolveProjectRunPrompt } from '../../shared/board/projectColumnPrompts.js';
import { BoardColumn, BoardTask } from '../../shared/types.js';
import { acpManager } from '../acp/client.js';
import { IdParams, route } from '../http/app.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';
import { TurnOrchestrator } from '../turns/orchestrator.js';
import { RouteContext } from './context.js';

/**
 * Dragging a card, which is the one place the board acts on its own.
 *
 * A column can be configured to start a fresh session, compact the old one and
 * run a prompt on arrival, so a move is a small pipeline rather than a field
 * update. It is here on its own because everything else under `taskRuns.ts` is
 * the user asking for a turn directly.
 */

/**
 * The move appends a "Moved" entry, and a stripped snapshot cannot carry it, so
 * it goes out as a delta like any streamed log. `before` is counted ahead of the
 * move because the store hands back live references, not copies.
 */
function publishMove(publisher: BoardPublisher, task: BoardTask, logsBeforeMove: number): void {
  publisher.updated(task);
  const moveLog = task.logs.length > logsBeforeMove ? task.logs[task.logs.length - 1] : undefined;
  if (moveLog) publisher.logDelta(task.id, moveLog);
}

/**
 * What entering a column runs, in order.
 *
 * Compaction goes first so the column's own prompt runs against the smaller
 * context. A failed compact is reported and the move still proceeds — the user
 * asked to move the card, not to gate it on summarization.
 */
function runColumnWork(
  orchestrator: TurnOrchestrator,
  task: BoardTask,
  column: BoardColumn,
  enter: ReturnType<typeof columnEnterActions>,
  previousSessionId: string | undefined
): void {
  const runColumnPrompt = () => {
    if (!enter.autoRun) return;
    void orchestrator.start(task.id, resolveProjectRunPrompt(column, task, taskStore.getSettings().projects), {
      reconfigure: true,
      columnId: column.id,
      // Explicit, so the stage's turn cannot land in a session that some other
      // code path re-bound between the archive above and this call.
      newSession: enter.newSession || undefined,
      primary: true,
      // Same rule as an explicit run: images typed with the task go with its
      // first turn, whichever path happens to send that turn.
      images: task.sessionId ? [] : (task.promptImages || [])
    });
  };

  if (enter.compact && previousSessionId && !orchestrator.isTurnBusy(task.id, previousSessionId)) {
    void orchestrator
      .compact(task.id, previousSessionId)
      .catch((e: unknown) => {
        console.error(`[Server] Compact on entering ${column.id} failed for ${task.id}:`, e);
      })
      .then(runColumnPrompt);
    return;
  }
  runColumnPrompt();
}

/** Moving a task between columns, and whatever the new column runs on arrival. */
export function registerTaskMoveRoutes(app: Express, { publisher, orchestrator }: RouteContext): void {
  app.post('/api/tasks/:id/move', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const { columnId } = req.body as { columnId?: string };
    if (!columnId) return res.status(400).json({ error: 'columnId is required' });

    const existing = taskStore.getTask(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const column = findColumn(taskStore.getSettings().columns, columnId);
    if (!column) return res.status(400).json({ error: 'Unknown column' });

    const enter = columnEnterActions(column, {
      sameColumn: existing.columnId === columnId,
      alreadyRan: existing.lastRunColumnId === columnId,
      busy: orchestrator.hasBusyWork(existing),
      hasSession: !!existing.sessionId
    });

    // A column that demands a fresh session retires the current one. The manager
    // has to let go of it too: it prefers its own binding over the task's, so
    // leaving it bound would continue the retired conversation instead.
    // Skipped while a turn is running — a drag is not a stop.
    if (enter.newSession) {
      taskStore.archiveStageSession(id, existing.columnId);
      acpManager.releasePrimarySession(id);
    }

    const logsBeforeMove = existing.logs.length;
    const updatedTask = taskStore.moveTask(id, columnId, { applyConfig: true });
    if (!updatedTask) return res.status(404).json({ error: 'Task not found' });

    publishMove(publisher, updatedTask, logsBeforeMove);
    runColumnWork(orchestrator, updatedTask, column, enter, existing.sessionId);

    res.json(publisher.present(taskStore.getTask(id) || updatedTask));
  }));
}
