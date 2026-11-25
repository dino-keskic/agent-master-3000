import { useEffect, useState } from 'react';
import { BoardTask } from '../../../shared/types';
import { SessionStartMode } from '../session/sessionMode';
import { BlankSessionStart, blankSessionPending } from '../../../shared/task/drawerTranscript';
import { ForkAnchor } from '../../../shared/transcript/forkPoint';

/**
 * What the drawer holds about the task on screen: which session, which tab,
 * what is half-typed, an optional fork cut-point, and what is mid-flight.
 *
 * All of it is per-panel and none of it is worth persisting. How wide the
 * workspace is belongs to the workspace, not to any one task.
 */

export interface DrawerState {
  promptText: string;
  setPromptText: (text: string) => void;
  /** True while an answer to a permission or question is on its way. */
  isResponding: boolean;
  setIsResponding: (busy: boolean) => void;
  isEditingTitle: boolean;
  setIsEditingTitle: (editing: boolean) => void;
  editedTitle: string;
  setEditedTitle: (title: string) => void;
  tab: string;
  setTab: (tab: string) => void;
  isCompacting: boolean;
  setIsCompacting: (busy: boolean) => void;
  sessionModalMode: SessionStartMode | null;
  setSessionModalMode: (mode: SessionStartMode | null) => void;
  /** Session to copy when the fork modal was opened from a specific sidebar row. */
  forkSourceSessionId: string | undefined;
  setForkSourceSessionId: (sessionId: string | undefined) => void;
  /** Selected transcript turn when branching from mid-session via the composer. */
  forkAnchor: ForkAnchor | null;
  setForkAnchor: (anchor: ForkAnchor | null) => void;
  /**
   * What the move dialog is moving: a session id, `null` for the task itself,
   * and undefined while it is closed.
   */
  moving: string | null | undefined;
  setMoving: (target: string | null | undefined) => void;
  /** The session being viewed, when it is not the task's own. */
  activeSessionId: string | undefined;
  /** Show a session, and the transcript tab it lives on. */
  viewSession: (sessionId: string | undefined) => void;
  /** A "New" click still waiting for its session; the transcript is empty meanwhile. */
  blankStart: BlankSessionStart | undefined;
  /** Show the blank session asked for, before OpenCode has opened it. */
  startBlank: () => void;
  /** The blank session was refused: show the task's own again. */
  cancelBlank: () => void;
}

export function useDrawerState(
  task: BoardTask | null,
  focusSessionId: string | null | undefined,
  onFocusHandled: (() => void) | undefined
): DrawerState {
  const [promptText, setPromptText] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [tab, setTab] = useState<string>('session');
  const [isCompacting, setIsCompacting] = useState(false);
  const [sessionModalMode, setSessionModalMode] = useState<SessionStartMode | null>(null);
  const [forkSourceSessionId, setForkSourceSessionId] = useState<string | undefined>(undefined);
  const [forkAnchor, setForkAnchor] = useState<ForkAnchor | null>(null);
  const [moving, setMoving] = useState<string | null | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [blankStart, setBlankStart] = useState<BlankSessionStart | undefined>(undefined);

  // Adjusting state during render beats a prop-sync effect: no extra commit,
  // and the drawer never paints one frame with the previous task's title.
  const [syncedTaskId, setSyncedTaskId] = useState(task?.id);
  if (task && task.id !== syncedTaskId) {
    setSyncedTaskId(task.id);
    setEditedTitle(task.title);
    setIsEditingTitle(false);
    // The previous task's session and fork anchor must not survive into this one.
    setActiveSessionId(undefined);
    setBlankStart(undefined);
    setMoving(undefined);
    setForkAnchor(null);
    setForkSourceSessionId(undefined);
  } else if (task && !isEditingTitle && editedTitle !== task.title) {
    setEditedTitle(task.title);
  }

  // The blank session has been linked as the task's main one: it is what the
  // drawer follows from here, so the stand-in goes in the same render.
  if (task && blankStart && !blankSessionPending(task, blankStart)) setBlankStart(undefined);

  // Opened from the activity panel on a specific session: show that one.
  useEffect(() => {
    if (!focusSessionId) return;
    setActiveSessionId(focusSessionId);
    setBlankStart(undefined);
    setForkAnchor(null);
    setTab('session');
    onFocusHandled?.();
  }, [focusSessionId, onFocusHandled]);

  return {
    promptText,
    setPromptText,
    isResponding,
    setIsResponding,
    isEditingTitle,
    setIsEditingTitle,
    editedTitle,
    setEditedTitle,
    tab,
    setTab,
    isCompacting,
    setIsCompacting,
    sessionModalMode,
    setSessionModalMode,
    forkSourceSessionId,
    setForkSourceSessionId,
    forkAnchor,
    setForkAnchor,
    moving,
    setMoving,
    activeSessionId,
    viewSession: (sessionId) => {
      setActiveSessionId(sessionId);
      setBlankStart(undefined);
      setForkAnchor(null);
      setTab('session');
    },
    blankStart,
    startBlank: () => {
      setActiveSessionId(undefined);
      setBlankStart({ fromSessionId: task?.sessionId });
      setForkAnchor(null);
      setTab('session');
    },
    cancelBlank: () => setBlankStart(undefined)
  };
}
