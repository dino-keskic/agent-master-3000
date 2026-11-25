import React, { useEffect, useRef, useState } from 'react';
import { ScrollArea, Textarea, Tooltip } from '@mantine/core';
import { Check, FileCode, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { SkillFileInfo } from '../../../shared/skills/skills';
import { Button, EmptyState, Surface } from '../ui';

/**
 * Bundled files inside a skill directory (`references/`, `scripts/`, `assets/`,
 * etc.): list, inspect, edit text files, or add a new helper file.
 */

interface SkillFilesEditorProps {
  dirPath: string;
  files: SkillFileInfo[];
  busy: boolean;
  onReadFile: (dirPath: string, relativePath: string) => Promise<string | null>;
  onSaveFile: (dirPath: string, relativePath: string, content: string) => Promise<boolean>;
  onDeleteFile: (dirPath: string, relativePath: string) => Promise<boolean>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const SkillFilesEditor: React.FC<SkillFilesEditorProps> = ({
  dirPath,
  files,
  busy,
  onReadFile,
  onSaveFile,
  onDeleteFile
}) => {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const openFile = async (relativePath: string) => {
    setLoadingFile(true);
    setCreatingFile(false);
    setConfirmDeletePath(null);
    const loaded = await onReadFile(dirPath, relativePath);
    if (loaded !== null) {
      setActiveFile(relativePath);
      setContent(loaded);
      setSavedContent(loaded);
    }
    setLoadingFile(false);
  };

  const handleSave = async () => {
    if (!activeFile) return;
    const ok = await onSaveFile(dirPath, activeFile, content);
    if (ok) setSavedContent(content);
  };

  const handleCreate = async () => {
    const trimmed = newPath.trim().replace(/^\/+/, '');
    if (!trimmed) return;
    const ok = await onSaveFile(dirPath, trimmed, '');
    if (ok) {
      setNewPath('');
      setCreatingFile(false);
      setActiveFile(trimmed);
      setContent('');
      setSavedContent('');
    }
  };

  const handleDelete = async (relativePath: string) => {
    const ok = await onDeleteFile(dirPath, relativePath);
    setConfirmDeletePath(null);
    if (ok && activeFile === relativePath) {
      setActiveFile(null);
      setContent('');
      setSavedContent('');
    }
  };

  const auxFiles = files.filter((f) => f.relativePath !== 'SKILL.md');
  const firstTextPath = auxFiles.find((f) => f.isText)?.relativePath;
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    if (autoLoadedRef.current || !firstTextPath) return;
    let cancelled = false;
    void onReadFile(dirPath, firstTextPath).then((loaded) => {
      if (cancelled || loaded === null) return;
      autoLoadedRef.current = true;
      setActiveFile(firstTextPath);
      setContent(loaded);
      setSavedContent(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [dirPath, firstTextPath, onReadFile]);

  return (
    <div className="flex-1 flex flex-col p-4 gap-3 min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs text-ink-3 truncate">
          Bundled files in <span className="font-mono text-ink-2">{dirPath}</span>
        </span>
        <Button
          size="xs"
          variant="secondary"
          leftSection={<Plus className="w-3 h-3" />}
          onClick={() => setCreatingFile((c) => !c)}
        >
          Add file
        </Button>
      </div>

      {creatingFile && (
        <Surface level="s1" radius="md" className="p-2.5 flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="references/guide.md or scripts/check.sh"
            value={newPath}
            onChange={(e) => setNewPath(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            autoFocus
            className="flex-1 h-7 px-2.5 rounded-lg border border-line bg-surface-2 font-mono text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-acc-bd"
          />
          <Button size="xs" variant="primary" loading={busy} disabled={!newPath.trim()} onClick={() => void handleCreate()}>
            Create
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setCreatingFile(false)}>
            Cancel
          </Button>
        </Surface>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[296px_minmax(0,1fr)] gap-3 min-h-0">
        <Surface level="s1" radius="lg" className="overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1">
            <div className="flex flex-col divide-y divide-hairline p-1.5">
              {auxFiles.length === 0 ? (
                <div className="py-8 px-3 text-center flex flex-col items-center gap-1.5">
                  <FolderOpen className="w-5 h-5 text-ink-4" />
                  <p className="m-0 text-xs text-ink-3">No extra files yet</p>
                  <p className="m-0 text-[11px] text-ink-4">
                    Add files under <span className="font-mono">references/</span>, <span className="font-mono">scripts/</span>, or <span className="font-mono">assets/</span>.
                  </p>
                </div>
              ) : (
                auxFiles.map((file) => {
                  const isSelected = activeFile === file.relativePath;
                  const confirming = confirmDeletePath === file.relativePath;
                  return (
                    <div
                      key={file.relativePath}
                      onClick={() => file.isText && void openFile(file.relativePath)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                        file.isText ? 'cursor-pointer' : 'opacity-65'
                      } ${isSelected ? 'bg-acc-bg text-ink' : 'hover:bg-s3h text-ink-2'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-acc-fg' : 'text-ink-3'}`} />
                        <span className="font-mono text-xs truncate">{file.relativePath}</span>
                        {!file.isText && <span className="text-[10.5px] text-ink-4">(binary)</span>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="font-mono text-[11px] text-ink-4">{formatBytes(file.size)}</span>
                        {confirming ? (
                          <Button
                            size="xs"
                            variant="danger"
                            loading={busy}
                            onClick={() => void handleDelete(file.relativePath)}
                          >
                            Delete
                          </Button>
                        ) : (
                          <Tooltip label="Delete file" withArrow>
                            <button
                              type="button"
                              className="icon-btn hover:text-err-fg w-6 h-6"
                              onClick={() => setConfirmDeletePath(file.relativePath)}
                              aria-label={`Delete ${file.relativePath}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Surface>

        {activeFile ? (
          <Surface level="s1" radius="lg" className="flex flex-col overflow-hidden min-h-0 focus-within:border-acc-bd">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-line bg-surface-2 shrink-0">
              <span className="font-mono text-xs font-medium text-ink truncate">{activeFile}</span>
              <Button
                size="xs"
                variant="primary"
                disabled={busy || loadingFile || content === savedContent}
                loading={busy}
                leftSection={<Check className="w-3 h-3" />}
                onClick={() => void handleSave()}
              >
                {content === savedContent ? 'Saved' : 'Save file'}
              </Button>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
              disabled={loadingFile}
              variant="unstyled"
              autosize={false}
              className="flex-1 flex flex-col p-3"
              styles={{
                wrapper: { flex: 1, display: 'flex' },
                input: { flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55, resize: 'none' }
              }}
              spellCheck={false}
            />
          </Surface>
        ) : (
          <div className="flex items-center justify-center p-4">
            <EmptyState
              compact
              icon={<FileCode className="w-4 h-4" />}
              title="No file selected"
              description={
                auxFiles.length > 0
                  ? 'Select a text file from the list to view or edit it.'
                  : 'Click "Add file" above to bundle scripts, references, or templates with this skill.'
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};
