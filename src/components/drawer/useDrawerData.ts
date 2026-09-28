import { useCallback, useEffect, useRef, useState } from 'react';
import { api, EditorOption } from '../../api';
import { SubagentSession } from '../../../shared/sessions/types';
import { TaskLogItem } from '../../../shared/types';

export interface DrawerData {
  editors: EditorOption[];
  /** The editor the drawer's own "open" buttons use. */
  primaryEditor?: EditorOption;
  /** Subagent trees, keyed by the linked session they descend from. */
  subagents: Record<string, SubagentSession[]>;
  /** Transcripts fetched from OpenCode, keyed by session. */
  sideSessionLogs: Record<string, TaskLogItem[]>;
}

/**
 * What the drawer reads from the server rather than from board state.
 *
 * The board only ever saw what happened while it was watching; OpenCode has the
 * rest. These fetches fill the gaps — the subagents a session spawned, and the
 * full transcript of whichever session is on screen — while live deltas keep
 * arriving over the websocket.
 */
/**
 * How often the subagent trees are re-read while the task is running. The
 * trees themselves barely change; what changes is which node is *live*, and a
 * running marker that lags by half a minute is worse than none — the user
 * opens the one it points at and finds a finished transcript.
 */
const SUBAGENT_POLL_MS = 5_000;

/**
 * Editors are a fixed server-side table, and a split view mounts one drawer per
 * panel — so the list is read once per page load and shared, not once per panel.
 */
let editorsRequest: Promise<EditorOption[]> | null = null;
function loadEditors(): Promise<EditorOption[]> {
  editorsRequest ??= api.listEditors().catch(() => {
    editorsRequest = null;
    return [];
  });
  return editorsRequest;
}

export function useDrawerData(
  taskId: string | undefined,
  subagentCount: number | undefined,
  sessionId: string | undefined,
  running?: boolean
): DrawerData {
  const [editors, setEditors] = useState<EditorOption[]>([]);
  const [subagents, setSubagents] = useState<Record<string, SubagentSession[]>>({});
  const [sideSessionLogs, setSideSessionLogs] = useState<Record<string, TaskLogItem[]>>({});

  useEffect(() => {
    let cancelled = false;
    void loadEditors().then((list) => {
      if (!cancelled) setEditors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dropping the previous task's trees during render rather than in an effect
  // keeps them from being painted for one frame under the new task's name.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setSubagents({});
  }

  // Which task the drawer is on by the time a fetch comes back: a poll started
  // for the previous one must not paint its trees under the new name.
  const liveTaskId = useRef(taskId);
  useEffect(() => {
    liveTaskId.current = taskId;
  }, [taskId]);

  const loadSubagents = useCallback(() => {
    if (!taskId) return;
    api.listTaskSubagents(taskId)
      .then((map) => {
        if (liveTaskId.current === taskId) setSubagents(map);
      })
      .catch(() => {
        if (liveTaskId.current === taskId) setSubagents({});
      });
  }, [taskId]);

  useEffect(() => {
    // No clearing here: the render-time reset above already dropped the
    // previous task's trees, and doing it twice costs a second render.
    loadSubagents();
  }, [subagentCount, loadSubagents]);

  /**
   * While the task runs, keep re-reading: a subagent starting, and one
   * finishing, are both invisible in board state — no `subagentCount` change
   * when a child merely stops — so nothing else would move the flags. One last
   * read when it stops clears the markers rather than freezing them mid-run.
   */
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) loadSubagents();
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(loadSubagents, SUBAGENT_POLL_MS);
    return () => clearInterval(timer);
  }, [running, loadSubagents]);

  /**
   * OpenCode's own messages carry the model/agent/thinking that actually ran.
   * Fetch once per session — not on every runState change, which rebuilt the
   * transcript and made the last message flash.
   */
  useEffect(() => {
    if (!taskId || !sessionId) return;
    let cancelled = false;
    api.getSessionHistory(taskId, sessionId)
      .then((history) => {
        if (!cancelled) setSideSessionLogs((prev) => ({ ...prev, [sessionId]: history.logs }));
      })
      .catch((e) => {
        console.warn('Could not fetch session history:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, sessionId]);

  return {
    editors,
    primaryEditor: editors.find((e) => e.id === 'vscode') || editors[0],
    subagents,
    sideSessionLogs
  };
}
