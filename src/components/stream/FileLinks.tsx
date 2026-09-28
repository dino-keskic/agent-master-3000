import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, EditorOption } from '../../api';
import { reportError } from '../../app/notify';
import { FileRef, fileRefLabel } from '../../../shared/transcript/fileLinks';

interface FileLinkContextValue {
  /** Task working directory — relative and bare absolute paths are resolved against it. */
  cwd?: string;
  /** Whose transcript this is: a path it names is openable even outside the board's folders. */
  taskId?: string;
  /** Null until an editor is known; nothing is linkified while it is, since a click could only fail. */
  editorId: string | null;
  open: (ref: FileRef) => void;
}

const FileLinkContext = createContext<FileLinkContextValue>({ editorId: null, open: () => {} });

// The editor table is a fixed server-side probe; one fetch serves every transcript.
let editorsPromise: Promise<EditorOption[]> | null = null;
function loadEditors(): Promise<EditorOption[]> {
  editorsPromise ??= api.listEditors().catch(() => []);
  return editorsPromise;
}

export const FileLinkProvider: React.FC<{ cwd?: string; taskId?: string; children: React.ReactNode }> = ({
  cwd,
  taskId,
  children
}) => {
  const [editorId, setEditorId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadEditors().then((editors) => {
      if (!alive) return;
      setEditorId((editors.find((e) => e.id === 'vscode') || editors[0])?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const open = useCallback(
    (ref: FileRef) => {
      if (!editorId) return;
      void api
        .openIn(editorId, ref.path, ref.line, taskId)
        .catch((e) => reportError('Could not open that file', e));
    },
    [editorId, taskId]
  );

  const value = useMemo(() => ({ cwd, taskId, editorId, open }), [cwd, taskId, editorId, open]);
  return <FileLinkContext.Provider value={value}>{children}</FileLinkContext.Provider>;
};

export function useFileLinks(): FileLinkContextValue {
  return useContext(FileLinkContext);
}

/**
 * A button, not an anchor: browsers refuse to navigate to `file://` from a
 * page, so opening goes through the server's editor launcher instead.
 */
export const FileLink: React.FC<{ target: FileRef; label: string; mono?: boolean }> = ({ target, label, mono }) => {
  const { open } = useFileLinks();
  return (
    <button
      type="button"
      onClick={() => open(target)}
      title={fileRefLabel(target)}
      className={`underline underline-offset-2 decoration-dotted decoration-accent/60 hover:decoration-accent text-accent hover:brightness-110 transition ${
        mono ? 'px-1 py-0.5 rounded bg-acc-bg text-[0.95em] font-mono no-underline' : ''
      }`}
    >
      {label}
    </button>
  );
};
