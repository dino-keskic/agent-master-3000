import { isArchived } from '../../shared/task/archive.js';
import { BoardTask, PendingRequest, ProjectFolder, TaskLogItem } from '../../shared/types.js';
import { LiveHub, stripLogs } from './hub.js';
import { Presenter } from './presenter.js';
import { taskStore } from '../board/taskStore.js';

/**
 * How long a streamed log waits for the next version of itself before it is
 * pushed. An agent streams a message as dozens of chunks a second, each one
 * the whole message so far, and each push carries the task's snapshot too — so
 * pushing every chunk cost a snapshot per word, and the bytes grew with the
 * square of the message length. At this interval the text still reads as
 * streaming.
 */
const LOG_PUSH_INTERVAL_MS = 100;

/**
 * Every push the board makes, named after what happened rather than after the
 * message shape.
 *
 * Presenting and stripping are applied here, so no caller can push a task that
 * is missing its queue or carrying a megabyte of transcript.
 */
export class BoardPublisher {
  /** taskId -> logId -> the newest version of that log not yet pushed. */
  private readonly pendingLogs = new Map<string, Map<string, TaskLogItem>>();
  private logTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly hub: LiveHub,
    private readonly presenter: Presenter
  ) {}

  /** The task as a client should see it — the same view every push carries. */
  present(task: BoardTask): BoardTask {
    return this.presenter.present(task);
  }

  /**
   * An archived task is never pushed as a card: a client that took the snapshot
   * would put it back on the board. It goes out as `deleted` instead, which is
   * what the board has to do with it either way.
   */
  updated(task: BoardTask): BoardTask {
    this.flushLogs(task.id);
    const live = this.present(task);
    if (isArchived(live)) {
      this.deleted(live.id);
      return live;
    }
    this.hub.send({ type: 'TASK_UPDATED', taskId: live.id, task: live });
    return live;
  }

  /** A push for a task id, when the caller has no snapshot in hand. */
  refresh(taskId: string): BoardTask | undefined {
    const task = taskStore.getTask(taskId);
    return task ? this.updated(task) : undefined;
  }

  status(task: BoardTask): BoardTask {
    this.flushLogs(task.id);
    const live = this.present(task);
    this.hub.send({ type: 'TASK_STATUS_CHANGED', taskId: live.id, status: live.runState, task: live });
    return live;
  }

  awaitingInput(taskId: string, task: BoardTask, request: PendingRequest): void {
    this.flushLogs(taskId);
    this.hub.send({ type: 'TASK_AWAITING_INPUT', taskId, task: this.present(task), request });
  }

  failed(taskId: string, message: string, task: BoardTask): void {
    this.flushLogs(taskId);
    this.hub.send({ type: 'ERROR', taskId, message, task: this.present(task) });
  }

  deleted(taskId: string): void {
    this.pendingLogs.delete(taskId);
    this.hub.send({ type: 'TASK_DELETED', taskId });
  }

  projects(projects: ProjectFolder[]): void {
    this.hub.send({ type: 'PROJECTS_UPDATED', projects });
  }

  /**
   * Record a log and push it as a delta.
   *
   * Every entry the store gains has to go out this way. A snapshot cannot carry
   * it — snapshots are stripped — so a log that is only stored leaves the
   * client's transcript one entry short of the server's until the task is
   * reopened.
   */
  log(taskId: string, log: TaskLogItem): BoardTask | null {
    const updated = taskStore.addLogToTask(taskId, log);
    // What the store kept — merged and clipped — not the raw update, which can
    // carry a tool's whole output.
    if (updated) this.logDelta(taskId, updated.logs.find((l) => l.id === log.id) ?? log);
    return updated;
  }

  /**
   * Push a log the store already holds — the "Moved" line a column change
   * appends on its own, rather than one this call is recording.
   *
   * Queued, not sent: a newer version of the same log within
   * `LOG_PUSH_INTERVAL_MS` replaces it, and any other push for the task sends
   * the queue first, so a client never sees a task go idle before the last
   * words of its turn. The snapshot goes out as it is when the queue drains.
   */
  logDelta(taskId: string, log: TaskLogItem): void {
    let pending = this.pendingLogs.get(taskId);
    if (!pending) {
      pending = new Map();
      this.pendingLogs.set(taskId, pending);
    }
    // A log already waiting keeps its place in the queue and takes the newer text.
    pending.set(log.id, log);
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      for (const id of [...this.pendingLogs.keys()]) this.flushLogs(id);
    }, LOG_PUSH_INTERVAL_MS);
    this.logTimer.unref();
  }

  /** Send a task's queued logs now, against one snapshot serialised once. */
  private flushLogs(taskId: string): void {
    const pending = this.pendingLogs.get(taskId);
    if (!pending) return;
    this.pendingLogs.delete(taskId);
    const task = taskStore.getTask(taskId);
    if (!task || !this.hub.hasClients()) return;
    const snapshot = JSON.stringify(stripLogs(this.present(task)));
    for (const log of pending.values()) {
      this.hub.sendPayload(`{"type":"TASK_LOG","taskId":${JSON.stringify(taskId)},"task":${snapshot},"log":${JSON.stringify(log)}}`);
    }
  }

  /**
   * A batch of logs that arrived at once, against one snapshot.
   *
   * The snapshot is identical for every log in the batch and is the larger half
   * of each message, so it is stringified once here rather than letting `log`
   * re-serialise the whole task per entry. A long resync used to pay for that
   * dozens of times over.
   */
  logBatch(taskId: string, logs: TaskLogItem[], task: BoardTask): void {
    this.flushLogs(taskId);
    if (logs.length === 0) {
      this.updated(task);
      return;
    }
    const snapshot = stripLogs(this.present(task));
    for (const log of logs) {
      this.hub.sendPayload(JSON.stringify({ type: 'TASK_LOG', taskId, task: snapshot, log }));
    }
  }

  /**
   * The queue is process state, so a change to it reaches the board only if
   * something is pushed — no store write happens to carry it along.
   */
  queueChanged(taskId: string): void {
    this.refresh(taskId);
  }
}
