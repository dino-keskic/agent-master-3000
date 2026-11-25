import React, { useMemo, useState } from 'react';
import { Collapse, ScrollArea, Switch, Textarea, Tooltip } from '@mantine/core';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  CornerDownLeft,
  Eye,
  FileText,
  FolderOpen,
  Pencil,
  Sliders,
  Trash2,
  X
} from 'lucide-react';
import {
  SaveSkillInput,
  SkillItem,
  SkillScope,
  isRecommendedSkillName,
  isValidSkillName,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  slugifySkillName
} from '../../../shared/skills/skills';
import { Markdown } from '../stream/Markdown';
import { Button, Chip, EmptyState, SegmentedControl, Surface } from '../ui';
import { SkillFilesEditor } from './SkillFilesEditor';

/**
 * Right-hand studio editor for skills (`SKILL.md` + bundled files).
 */

interface SkillEditorProps {
  skill: SkillItem | null;
  creating: boolean;
  busy: boolean;
  narrow: boolean;
  onBack: () => void;
  onSave: (input: SaveSkillInput) => Promise<SkillItem | null>;
  onDelete: (dirPath: string) => Promise<void>;
  onToggleSkill?: (name: string, enabled: boolean) => void;
  onReadAuxFile: (dirPath: string, relativePath: string) => Promise<string | null>;
  onSaveAuxFile: (dirPath: string, relativePath: string, content: string) => Promise<boolean>;
  onDeleteAuxFile: (dirPath: string, relativePath: string) => Promise<boolean>;
  onInsertSkill?: (name: string) => void;
}

interface DraftState {
  name: string;
  scope: SkillScope;
  description: string;
  compatibility: string;
  license: string;
  allowedTools: string[];
  body: string;
  metadata?: Record<string, string>;
  extraFrontmatter?: Record<string, unknown>;
  rawText: string;
  rawEdited: boolean;
}

const FIELD_INPUT =
  'w-full h-8 px-2.5 rounded-lg border border-line bg-surface-2 text-ink text-[12.5px] placeholder:text-ink-4 focus:outline-none focus:border-acc-bd transition-colors';

function draftFromSkill(skill: SkillItem | null, creating: boolean): DraftState {
  if (creating || !skill) {
    return {
      name: '',
      scope: 'project',
      description: '',
      compatibility: '',
      license: '',
      allowedTools: [],
      body: '',
      rawText: '',
      rawEdited: false
    };
  }
  return {
    name: skill.name,
    scope: skill.scope,
    description: skill.description,
    compatibility: skill.compatibility || '',
    license: skill.license || '',
    allowedTools: [...(skill.allowedTools || [])],
    body: skill.body,
    metadata: skill.metadata,
    extraFrontmatter: skill.extraFrontmatter,
    rawText: skill.rawMarkdown,
    rawEdited: false
  };
}

export const SkillEditor: React.FC<SkillEditorProps> = ({
  skill,
  creating,
  busy,
  narrow,
  onBack,
  onSave,
  onDelete,
  onToggleSkill,
  onReadAuxFile,
  onSaveAuxFile,
  onDeleteAuxFile,
  onInsertSkill
}) => {
  const sourceKey = creating ? 'new' : skill?.key ?? 'none';
  const versionKey = creating ? 'new' : `${sourceKey}:${skill?.rawMarkdown ?? ''}`;
  const [syncedKey, setSyncedKey] = useState(versionKey);
  const [draft, setDraft] = useState<DraftState>(() => draftFromSkill(skill, creating));
  const [view, setView] = useState<'editor' | 'files' | 'raw'>('editor');
  const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>('edit');
  const [metaOpen, setMetaOpen] = useState(false);
  const [toolInput, setToolInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (versionKey !== syncedKey) {
    setSyncedKey(versionKey);
    setDraft(draftFromSkill(skill, creating));
    setConfirmDelete(false);
    if (!creating && skill && (skill.compatibility || skill.license || skill.allowedTools?.length)) {
      setMetaOpen(true);
    }
    if (creating && view === 'files') setView('editor');
  }

  const serializedDraft = useMemo(
    () =>
      serializeSkillMarkdown({
        name: draft.name || 'new-skill',
        description: draft.description,
        compatibility: draft.compatibility || undefined,
        license: draft.license || undefined,
        allowedTools: draft.allowedTools.length > 0 ? draft.allowedTools : undefined,
        metadata: draft.metadata,
        body: draft.body,
        extraFrontmatter: draft.extraFrontmatter
      }),
    [draft]
  );

  const dirty = useMemo(() => {
    if (creating) return true;
    if (!skill) return false;
    if (draft.rawEdited) return draft.rawText !== skill.rawMarkdown;
    return (
      draft.name !== skill.name ||
      draft.scope !== skill.scope ||
      draft.description !== skill.description ||
      draft.compatibility !== (skill.compatibility || '') ||
      draft.license !== (skill.license || '') ||
      JSON.stringify(draft.allowedTools) !== JSON.stringify(skill.allowedTools || []) ||
      draft.body !== skill.body
    );
  }, [creating, skill, draft]);

  const nameValid = isValidSkillName(draft.name);
  const canSave = dirty && nameValid && !busy;

  const handleViewChange = (target: 'editor' | 'files' | 'raw') => {
    if (view === 'raw' && target !== 'raw' && draft.rawEdited && (skill || creating)) {
      const reparsed = parseSkillMarkdown(draft.rawText, {
        dirName: skill?.dirName || draft.name || 'new-skill',
        scope: draft.scope,
        layout: skill?.layout || 'opencode',
        dirPath: skill?.dirPath || '',
        filePath: skill?.filePath || '',
        locationLabel: skill?.locationLabel || (draft.scope === 'project' ? '.opencode/skills' : '~/.config/opencode/skills')
      });
      setDraft((prev) => ({
        ...prev,
        name: reparsed.name,
        description: reparsed.description,
        compatibility: reparsed.compatibility || '',
        license: reparsed.license || '',
        allowedTools: [...(reparsed.allowedTools || [])],
        body: reparsed.body,
        metadata: reparsed.metadata,
        extraFrontmatter: reparsed.extraFrontmatter
      }));
    } else if (view !== 'raw' && target === 'raw' && !draft.rawEdited) {
      setDraft((prev) => ({ ...prev, rawText: serializedDraft }));
    }
    setView(target);
  };

  const handleSave = async () => {
    if (!canSave) return;
    await onSave({
      dirPath: creating ? undefined : skill?.dirPath,
      name: draft.name.trim(),
      scope: draft.scope,
      description: draft.description,
      compatibility: draft.compatibility || undefined,
      license: draft.license || undefined,
      allowedTools: draft.allowedTools.length > 0 ? draft.allowedTools : undefined,
      metadata: draft.metadata,
      body: draft.body,
      extraFrontmatter: draft.extraFrontmatter,
      ...(draft.rawEdited ? { rawMarkdown: draft.rawText } : {})
    });
  };

  const addAllowedTool = () => {
    const items = toolInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    setDraft((prev) => ({
      ...prev,
      allowedTools: [...new Set([...prev.allowedTools, ...items])],
      rawEdited: false
    }));
    setToolInput('');
  };

  if (!creating && !skill) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          title="No skill selected"
          description="Pick a skill on the left to read or edit its instructions and bundled files, or create a new skill."
        />
      </div>
    );
  }

  const auxCount = skill ? Math.max(0, skill.files.filter((f) => f.relativePath !== 'SKILL.md').length) : 0;
  const bodyLines = draft.body ? draft.body.split('\n').length : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-canvas/30">
      {/* Studio Header */}
      <div className="px-4 py-3 border-b border-line bg-surface shrink-0 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {narrow && (
              <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to skills">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="font-mono text-[15px] font-semibold text-ink truncate">
              /{creating ? draft.name || 'new-skill' : skill!.name}
            </span>
            <Chip tone={draft.scope === 'project' ? 'accent' : 'neutral'}>{draft.scope}</Chip>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!creating && skill && onToggleSkill && (
              <Tooltip
                label={
                  skill.disabled
                    ? `Enable /${skill.name} so OpenCode can load it`
                    : `Disable /${skill.name} without deleting its files`
                }
                withArrow
              >
                <div className="flex items-center mr-1">
                  <Switch
                    size="xs"
                    label={skill.disabled ? 'Disabled' : 'Enabled'}
                    checked={!skill.disabled}
                    disabled={busy}
                    onChange={(e) => onToggleSkill(skill.name, e.currentTarget.checked)}
                    aria-label={`${skill.disabled ? 'Enable' : 'Disable'} ${skill.name}`}
                  />
                </div>
              </Tooltip>
            )}
            {!creating && skill && onInsertSkill && (
              <Tooltip label={`Insert /${skill.name} into the prompt`} withArrow>
                <Button
                  size="xs"
                  variant="run"
                  leftSection={<CornerDownLeft className="w-3 h-3" />}
                  onClick={() => onInsertSkill(skill.name)}
                >
                  Use /{skill.name}
                </Button>
              </Tooltip>
            )}
            {!creating && skill && (
              confirmDelete ? (
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="danger" loading={busy} onClick={() => void onDelete(skill.dirPath)}>
                    Confirm delete
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Tooltip label="Delete skill directory" withArrow>
                  <button
                    type="button"
                    className="icon-btn hover:text-err-fg"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete skill"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )
            )}
            <Button
              size="xs"
              variant="primary"
              disabled={!canSave}
              loading={busy}
              leftSection={<Check className="w-3 h-3" />}
              onClick={() => void handleSave()}
            >
              {creating ? 'Create skill' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={handleViewChange}
            options={[
              { value: 'editor', label: 'Instructions', icon: <FileText className="w-3 h-3" /> },
              ...(!creating && skill
                ? [{ value: 'files' as const, label: 'Files', icon: <FolderOpen className="w-3 h-3" />, count: auxCount || undefined }]
                : []),
              { value: 'raw', label: 'Raw .md', icon: <Code2 className="w-3 h-3" /> }
            ]}
          />
          {!creating && skill && (
            <span className="font-mono text-[11px] text-ink-4 truncate max-w-xs" title={skill.filePath}>
              {skill.locationLabel}/{skill.dirName}
            </span>
          )}
        </div>
      </div>

      {view === 'files' && !creating && skill ? (
        <SkillFilesEditor
          key={skill.dirPath}
          dirPath={skill.dirPath}
          files={skill.files}
          busy={busy}
          onReadFile={onReadAuxFile}
          onSaveFile={onSaveAuxFile}
          onDeleteFile={onDeleteAuxFile}
        />
      ) : view === 'raw' ? (
        <div className="flex-1 flex flex-col p-4 min-h-0">
          <Surface level="s1" radius="lg" className="flex-1 flex flex-col overflow-hidden focus-within:border-acc-bd">
            <Textarea
              value={draft.rawEdited ? draft.rawText : serializedDraft}
              onChange={(e) => setDraft((prev) => ({ ...prev, rawText: e.currentTarget.value, rawEdited: true }))}
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
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 pb-16 max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px] gap-4 items-start">
              {/* Main Canvas: Instructions (SKILL.md) */}
              <Surface
                level="s1"
                radius="lg"
                className="overflow-hidden flex flex-col focus-within:border-acc-bd focus-within:shadow-[0_0_0_3px_var(--acc-bg)]"
              >
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-line bg-surface-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">Instructions (SKILL.md)</span>
                    <span className="font-mono text-[11px] text-ink-4">{bodyLines} ln</span>
                  </div>
                  <SegmentedControl
                    size="xs"
                    value={bodyMode}
                    onChange={setBodyMode}
                    options={[
                      { value: 'edit', label: 'Edit', icon: <Pencil className="w-3 h-3" /> },
                      { value: 'preview', label: 'Preview', icon: <Eye className="w-3 h-3" /> }
                    ]}
                  />
                </div>
                {bodyMode === 'preview' ? (
                  <div className="p-4 min-h-[280px]">
                    {draft.body.trim() ? (
                      <Markdown>{draft.body}</Markdown>
                    ) : (
                      <p className="m-0 text-xs text-ink-4 italic">No instructions written yet.</p>
                    )}
                  </div>
                ) : (
                  <Textarea
                    variant="unstyled"
                    placeholder={'# Guidelines\n\n- Step 1…'}
                    minRows={14}
                    maxRows={28}
                    autosize
                    value={draft.body}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setDraft((prev) => ({ ...prev, body: val, rawEdited: false }));
                    }}
                    className="px-3.5 py-3"
                    styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6 } }}
                  />
                )}
              </Surface>

              {/* Right Inspector: Identity, Trigger & Optional Metadata */}
              <div className="flex flex-col gap-3 min-w-0">
                <Surface level="s1" radius="lg" className="p-3.5 flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ink-2">Skill name</span>
                    <input
                      type="text"
                      placeholder="git-release"
                      value={draft.name}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setDraft((prev) => ({ ...prev, name: val, rawEdited: false }));
                      }}
                      onBlur={() => {
                        if (creating && draft.name && !isValidSkillName(draft.name)) {
                          setDraft((prev) => ({ ...prev, name: slugifySkillName(prev.name) }));
                        }
                      }}
                      className={`${FIELD_INPUT} font-mono`}
                    />
                    {draft.name && !nameValid ? (
                      <span className="text-[11px] text-err-fg">Use letters, digits, ., _, or -</span>
                    ) : draft.name && !isRecommendedSkillName(draft.name) ? (
                      <span className="text-[11px] text-wait-fg">Tip: lowercase-kebab-case recommended</span>
                    ) : null}
                  </label>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium text-ink-2">Location</span>
                      <span className="font-mono text-[10.5px] text-ink-4">
                        {draft.scope === 'project' ? '.opencode/skills' : '~/.config/opencode'}
                      </span>
                    </div>
                    <SegmentedControl
                      size="sm"
                      fullWidth
                      value={draft.scope}
                      onChange={(val) => setDraft((prev) => ({ ...prev, scope: val, rawEdited: false }))}
                      options={[
                        { value: 'project', label: 'Project' },
                        { value: 'global', label: 'Global' }
                      ]}
                    />
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ink-2">Trigger description</span>
                    <span className="text-[11px] text-ink-3">
                      OpenCode evaluates this to decide when to load the skill.
                    </span>
                    <textarea
                      placeholder="Create consistent releases and draft changelogs. Use when preparing a release."
                      rows={3}
                      value={draft.description}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setDraft((prev) => ({ ...prev, description: val, rawEdited: false }));
                      }}
                      className="w-full p-2.5 rounded-lg border border-line bg-surface-2 text-ink text-[12px] leading-snug placeholder:text-ink-4 focus:outline-none focus:border-acc-bd resize-y"
                    />
                  </label>
                </Surface>

                <Surface level="s1" radius="lg" className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMetaOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 bg-transparent border-0 text-left cursor-pointer hover:bg-s3h"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
                      <Sliders className="w-3.5 h-3.5 text-ink-3" />
                      Optional metadata
                    </span>
                    {metaOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-ink-3" />
                    )}
                  </button>
                  <Collapse in={metaOpen}>
                    <div className="px-3.5 pb-3.5 pt-2.5 border-t border-line flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-ink-2">Compatibility</span>
                          <input
                            type="text"
                            placeholder="opencode"
                            value={draft.compatibility}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setDraft((prev) => ({ ...prev, compatibility: val, rawEdited: false }));
                            }}
                            className={FIELD_INPUT}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-ink-2">License</span>
                          <input
                            type="text"
                            placeholder="MIT"
                            value={draft.license}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setDraft((prev) => ({ ...prev, license: val, rawEdited: false }));
                            }}
                            className={FIELD_INPUT}
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11.5px] font-medium text-ink-2">Allowed tools</span>
                        {draft.allowedTools.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {draft.allowedTools.map((tool) => (
                              <Chip key={tool} tone="accent" className="font-mono pr-1">
                                <span>{tool}</span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${tool}`}
                                  onClick={() =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      allowedTools: prev.allowedTools.filter((t) => t !== tool),
                                      rawEdited: false
                                    }))
                                  }
                                  className="bg-transparent border-0 p-0 ml-0.5 text-current opacity-70 hover:opacity-100 cursor-pointer flex items-center"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Chip>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="read, grep…"
                            value={toolInput}
                            onChange={(e) => setToolInput(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addAllowedTool();
                              }
                            }}
                            className={`${FIELD_INPUT} flex-1 font-mono`}
                          />
                          <Button size="xs" variant="secondary" disabled={!toolInput.trim()} onClick={addAllowedTool}>
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Collapse>
                </Surface>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
