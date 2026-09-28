import { useEffect, useState } from 'react';
import { ProjectFolder, PromptImage } from '../../../shared/types';
import { WorktreeEntry } from '../../../shared/git/worktree';
import { api, StartSessionInput } from '../../api';
import { SessionStartMode } from './sessionMode';

/**
 * What a new session will be started with.
 *
 * The fields open on what the session being forked runs as, and are sent as
 * they stand. The server keeps only what departs from the task's own settings,
 * so a session left on those keeps following them.
 */

export interface NewSessionDefaults {
  opened: boolean;
  mode: SessionStartMode;
  model: string;
  agent: string;
  thinkingLevel: string;
  projects: ProjectFolder[];
  projectId?: string;
  cwd?: string;
  onSubmit: (data: StartSessionInput) => Promise<void>;
  onDone: () => void;
}

export interface NewSessionForm {
  prompt: string;
  setPrompt: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  agent: string;
  setAgent: (value: string) => void;
  thinkingLevel: string;
  setThinkingLevel: (value: string) => void;
  project: ProjectFolder | undefined;
  projectPath: string;
  chooseProject: (id: string) => void;
  cwd: string;
  setCwd: (value: string) => void;
  /** Live worktrees of the chosen project; empty unless a blank session can use them. */
  worktrees: WorktreeEntry[];
  isSubmitting: boolean;
  /** A fork exists to ask something; a blank session can just be opened empty. */
  promptRequired: boolean;
  canSubmit: boolean;
  /**
   * Start the session. The composer passes the prompt it built — the typed
   * text plus whatever the tickets linked in it brought along — and the images
   * dropped into the box; without them what was typed is used as it stands.
   */
  submit: (prompt?: string, images?: PromptImage[]) => Promise<void>;
}

export function useNewSessionForm(defaults: NewSessionDefaults): NewSessionForm {
  const { opened, mode, projects, onSubmit, onDone } = defaults;
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(defaults.model);
  const [agent, setAgent] = useState(defaults.agent);
  const [thinkingLevel, setThinkingLevel] = useState(defaults.thinkingLevel);
  const [projectId, setProjectId] = useState(defaults.projectId || projects[0]?.id || '');
  const [cwd, setCwd] = useState(defaults.cwd || '');
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const project = projects.find((p) => p.id === projectId) || projects[0];
  const projectPath = project?.path || '';

  // Each opening starts clean, and so does switching mode. Done during render
  // rather than in an effect so the modal never paints the last visit's draft.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = opened ? mode : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (seedKey) {
      setPrompt('');
      setModel(defaults.model);
      setAgent(defaults.agent);
      setThinkingLevel(defaults.thinkingLevel);
      setProjectId(defaults.projectId || projects[0]?.id || '');
      setCwd(defaults.cwd || '');
      setIsSubmitting(false);
    }
  }

  // A fork runs where its source runs, so only a blank session offers folders.
  useEffect(() => {
    if (mode !== 'new' || !projectPath) {
      setWorktrees([]);
      return;
    }
    let cancelled = false;
    api.listWorktrees(projectPath)
      .then((list) => {
        if (cancelled) return;
        const live = list.filter((w) => !w.bare && !w.prunable);
        setWorktrees(live);
        const paths = live.map((w) => w.path);
        if (!cwd || !paths.includes(cwd)) setCwd(projectPath);
      })
      .catch(() => {
        if (!cancelled) {
          setWorktrees([]);
          setCwd(projectPath);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, projectPath]);

  const canSubmit = mode === 'fork' ? !!prompt.trim() : true;

  return {
    prompt,
    setPrompt,
    model,
    setModel,
    agent,
    setAgent,
    thinkingLevel,
    setThinkingLevel,
    project,
    projectPath,
    chooseProject: (id) => {
      setProjectId(id);
      const next = projects.find((p) => p.id === id);
      if (next) setCwd(next.path);
    },
    cwd,
    setCwd,
    worktrees,
    isSubmitting,
    promptRequired: mode === 'fork',
    canSubmit,
    async submit(text, images) {
      const body = (text ?? prompt).trim();
      if ((mode === 'fork' && !body && !images?.length) || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await onSubmit({
          mode,
          prompt: body || undefined,
          images: images?.length ? images : undefined,
          // Always sent, even untouched: the box opens on what the session
          // being forked runs as, and leaving it alone means "the same as
          // that" — not "whatever the task happens to be set to".
          model,
          agent,
          thinkingLevel,
          ...(mode === 'new' ? { cwd: cwd || projectPath || undefined, projectId: project?.id } : {})
        });
        setPrompt('');
        onDone();
      } finally {
        setIsSubmitting(false);
      }
    }
  };
}
