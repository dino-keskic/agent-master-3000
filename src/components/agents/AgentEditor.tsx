import React, { useMemo, useState } from 'react';
import { Collapse, NumberInput, ScrollArea, Select, Switch, Textarea, Tooltip } from '@mantine/core';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileText,
  Pencil,
  Play,
  Sliders,
  Trash2,
  Wrench
} from 'lucide-react';
import {
  CustomAgent,
  SaveAgentInput,
  isValidAgentId,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  setAgentToolRule,
  slugifyAgentId
} from '../../../shared/agent/customAgents';
import { SessionToolInventory } from '../../../shared/agent/tools';
import { modelOptionLabel } from '../../../shared/agent/modelScope';
import { OpenCodeModel } from '../../../shared/sessions/types';
import { Markdown } from '../stream/Markdown';
import { Banner, Button, Chip, EmptyState, SegmentedControl, Surface } from '../ui';
import { AgentToolsEditor } from './AgentToolsEditor';

/**
 * Right-hand studio editor for a custom (or built-in) agent:
 * - Definition: side-by-side System Prompt canvas + Identity & Routing inspector
 * - Tools: enable/disable built-in, plugin, MCP, board, or custom pattern rules
 * - Raw .md: direct frontmatter + markdown editing
 */

interface AgentEditorProps {
  agent: CustomAgent | null;
  creating: boolean;
  template: CustomAgent | null;
  models: OpenCodeModel[];
  activeAgent?: string;
  toolInventory: SessionToolInventory | null;
  agentToolPolicy?: Record<string, boolean>;
  toolsLoading: boolean;
  busy: boolean;
  narrow: boolean;
  onBack: () => void;
  onSave: (input: SaveAgentInput) => Promise<CustomAgent | null>;
  onImmediateToggleTool: (agent: CustomAgent, rule: string, enabled: boolean | null) => Promise<void>;
  onDelete: (filePath: string) => Promise<void>;
  onDuplicate: (agent: CustomAgent) => void;
  onUseInSession?: (agentId: string) => void;
}

interface DraftState {
  id: string;
  scope: 'project' | 'global';
  description: string;
  mode: string;
  model: string;
  temperature: number | '';
  steps: number | '';
  color: string;
  hidden: boolean;
  disabled: boolean;
  prompt: string;
  tools: Record<string, boolean>;
  extraFrontmatter?: Record<string, unknown>;
  rawText: string;
  rawEdited: boolean;
  idTouched: boolean;
}

const DEFAULT_MODEL = '__default__';

const FIELD_INPUT =
  'w-full h-8 px-2.5 rounded-lg border border-line bg-surface-2 text-ink text-[12.5px] placeholder:text-ink-4 focus:outline-none focus:border-acc-bd transition-colors disabled:opacity-60';

function draftFromAgent(agent: CustomAgent | null, creating: boolean, template: CustomAgent | null): DraftState {
  if (creating) {
    const baseId = template ? `${template.id}-custom` : '';
    const tools = template
      ? { ...(template.sourceKind === 'markdown' ? template.tools : template.resolvedTools || {}) }
      : {};
    const prompt = template?.prompt || '';
    const description = template?.description || '';
    const mode = template?.mode || 'all';
    const model = template?.model || '';
    return {
      id: baseId,
      scope: 'project',
      description,
      mode,
      model,
      temperature: template?.temperature ?? '',
      steps: template?.steps ?? '',
      color: template?.color || '',
      hidden: !!template?.hidden,
      disabled: !!template?.disabled,
      prompt,
      tools,
      rawText: serializeAgentMarkdown({ description, mode, model, prompt, tools }),
      rawEdited: false,
      idTouched: !!template
    };
  }
  if (!agent) {
    return {
      id: '',
      scope: 'project',
      description: '',
      mode: 'all',
      model: '',
      temperature: '',
      steps: '',
      color: '',
      hidden: false,
      disabled: false,
      prompt: '',
      tools: {},
      rawText: '',
      rawEdited: false,
      idTouched: false
    };
  }
  const scope: 'project' | 'global' = agent.scope === 'global' ? 'global' : 'project';
  return {
    id: agent.id,
    scope,
    description: agent.description,
    mode: agent.mode || 'all',
    model: agent.model || '',
    temperature: agent.temperature ?? '',
    steps: agent.steps ?? '',
    color: agent.color || '',
    hidden: !!agent.hidden,
    disabled: !!agent.disabled,
    prompt: agent.prompt,
    tools: { ...agent.tools },
    extraFrontmatter: agent.extraFrontmatter,
    rawText: agent.rawMarkdown ?? serializeAgentMarkdown({ ...agent }),
    rawEdited: false,
    idTouched: true
  };
}

export const AgentEditor: React.FC<AgentEditorProps> = ({
  agent,
  creating,
  template,
  models,
  activeAgent,
  toolInventory,
  agentToolPolicy,
  toolsLoading,
  busy,
  narrow,
  onBack,
  onSave,
  onImmediateToggleTool,
  onDelete,
  onDuplicate,
  onUseInSession
}) => {
  const sourceKey = creating ? `new:${template?.key ?? ''}` : agent?.key ?? 'none';
  const [syncedKey, setSyncedKey] = useState(sourceKey);
  const [draft, setDraft] = useState<DraftState>(() => draftFromAgent(agent, creating, template));
  const [view, setView] = useState<'config' | 'tools' | 'raw'>('config');
  const [promptMode, setPromptMode] = useState<'edit' | 'preview'>('edit');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const versionKey = creating ? sourceKey : `${sourceKey}:${agent?.rawMarkdown ?? ''}`;
  if (versionKey !== syncedKey) {
    setSyncedKey(versionKey);
    const next = draftFromAgent(agent, creating, template);
    setDraft(next);
    setConfirmDelete(false);
    if (
      !creating &&
      agent &&
      (agent.temperature !== undefined || agent.steps !== undefined || agent.color || agent.hidden || agent.disabled)
    ) {
      setAdvancedOpen(true);
    }
  }

  const isEditable = creating || !!agent?.editable;
  const serializedDraft = useMemo(
    () =>
      serializeAgentMarkdown({
        description: draft.description,
        mode: draft.mode === 'all' && !agent?.mode ? undefined : draft.mode,
        model: draft.model || undefined,
        temperature: typeof draft.temperature === 'number' ? draft.temperature : undefined,
        steps: typeof draft.steps === 'number' ? draft.steps : undefined,
        color: draft.color || undefined,
        hidden: draft.hidden || undefined,
        disabled: draft.disabled || undefined,
        tools: draft.tools,
        prompt: draft.prompt,
        extraFrontmatter: draft.extraFrontmatter
      }),
    [draft, agent?.mode]
  );

  const dirty = useMemo(() => {
    if (creating) return true;
    if (!agent || !agent.editable) return false;
    if (draft.rawEdited) return draft.rawText !== (agent.rawMarkdown ?? '');
    return (
      draft.id !== agent.id ||
      draft.scope !== agent.scope ||
      draft.description !== agent.description ||
      draft.mode !== (agent.mode || 'all') ||
      draft.model !== (agent.model || '') ||
      draft.temperature !== (agent.temperature ?? '') ||
      draft.steps !== (agent.steps ?? '') ||
      draft.color !== (agent.color || '') ||
      draft.hidden !== !!agent.hidden ||
      draft.disabled !== !!agent.disabled ||
      draft.prompt !== agent.prompt ||
      JSON.stringify(draft.tools) !== JSON.stringify(agent.tools)
    );
  }, [creating, agent, draft]);

  const idValid = isValidAgentId(draft.id);
  const canSave = isEditable && dirty && idValid && !busy;

  const modelData = useMemo(() => {
    const items = models.map((m) => ({
      value: m.id,
      label: m.scope ? `${modelOptionLabel(m)} (${m.scope})` : modelOptionLabel(m)
    }));
    if (draft.model && !items.some((m) => m.value === draft.model)) {
      items.unshift({ value: draft.model, label: draft.model });
    }
    return [{ value: DEFAULT_MODEL, label: 'Session / board default' }, ...items];
  }, [models, draft.model]);

  const handleViewChange = (target: 'config' | 'tools' | 'raw') => {
    if (view === 'raw' && target !== 'raw' && draft.rawEdited && (agent || creating)) {
      const reparsed = parseAgentMarkdown(draft.rawText, {
        id: draft.id || agent?.id || 'new-agent',
        scope: draft.scope,
        filePath: agent?.filePath || '',
        locationLabel: agent?.locationLabel || (draft.scope === 'project' ? '.opencode/agents' : '~/.config/opencode/agents')
      });
      setDraft((prev) => ({
        ...prev,
        description: reparsed.description,
        mode: reparsed.mode || 'all',
        model: reparsed.model || '',
        temperature: reparsed.temperature ?? '',
        steps: reparsed.steps ?? '',
        color: reparsed.color || '',
        hidden: !!reparsed.hidden,
        disabled: !!reparsed.disabled,
        prompt: reparsed.prompt,
        tools: reparsed.tools,
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
      filePath: creating ? undefined : agent?.filePath,
      id: draft.id.trim(),
      scope: draft.scope,
      description: draft.description,
      mode: draft.mode === 'all' && !agent?.mode ? undefined : draft.mode,
      model: draft.model || undefined,
      temperature: typeof draft.temperature === 'number' ? draft.temperature : undefined,
      steps: typeof draft.steps === 'number' ? draft.steps : undefined,
      color: draft.color || undefined,
      hidden: draft.hidden || undefined,
      disabled: draft.disabled || undefined,
      prompt: draft.prompt,
      tools: draft.tools,
      extraFrontmatter: draft.extraFrontmatter,
      ...(draft.rawEdited ? { rawMarkdown: draft.rawText } : {})
    });
  };

  const handleToggleRule = (rule: string, enabled: boolean | null) => {
    if (!creating && agent && (!agent.editable || !dirty)) {
      void onImmediateToggleTool(agent, rule, enabled);
      return;
    }
    setDraft((prev) => ({
      ...prev,
      rawEdited: false,
      tools: setAgentToolRule(prev.tools, rule, enabled)
    }));
  };

  const handleResetTools = () => {
    if (!creating && agent && !agent.editable) {
      for (const rule of Object.keys(agentToolPolicy || {})) {
        void onImmediateToggleTool(agent, rule, null);
      }
      return;
    }
    setDraft((prev) => ({ ...prev, rawEdited: false, tools: {} }));
  };

  if (!creating && !agent) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          title="No agent selected"
          description="Pick an agent on the left to inspect or edit its prompt and tool access, or create a new custom agent."
        />
      </div>
    );
  }

  const isActive = !creating && !!agent && !!activeAgent && agent.id.toLowerCase() === activeAgent.toLowerCase();
  const effectiveToolEntries = Object.entries(
    !creating && agent && !agent.editable ? agentToolPolicy || {} : draft.tools
  );
  const disabledRulesCount = effectiveToolEntries.filter(([, v]) => v === false).length;
  const promptLines = draft.prompt ? draft.prompt.split('\n').length : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-canvas/30">
      {/* Studio Header */}
      <div className="px-4 py-3 border-b border-line bg-surface shrink-0 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {narrow && (
              <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to agents">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {draft.color && (
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                style={{ backgroundColor: draft.color }}
              />
            )}
            <span className="font-mono text-[15px] font-semibold text-ink truncate">
              {creating ? draft.id || 'new-agent' : agent!.id}
            </span>
            <Chip tone={creating || agent?.scope === 'project' ? 'accent' : 'neutral'}>
              {creating ? draft.scope : agent!.scope}
            </Chip>
            {!creating && agent?.sourceKind === 'config' && <Chip>opencode.json</Chip>}
            {isActive && <Chip tone="run">active</Chip>}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!creating && agent && !isActive && onUseInSession && !agent.disabled && (
              <Tooltip label={`Switch this session to ${agent.id}`} withArrow>
                <Button
                  size="xs"
                  variant="run"
                  leftSection={<Play className="w-3 h-3" />}
                  onClick={() => onUseInSession(agent.id)}
                >
                  Use in session
                </Button>
              </Tooltip>
            )}
            {!creating && agent && (
              <Tooltip label="Duplicate as a new custom agent" withArrow>
                <Button
                  size="xs"
                  variant="ghost"
                  leftSection={<Copy className="w-3 h-3" />}
                  onClick={() => onDuplicate(agent)}
                >
                  Clone
                </Button>
              </Tooltip>
            )}
            {!creating && agent?.editable && agent.filePath && (
              confirmDelete ? (
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="danger" loading={busy} onClick={() => void onDelete(agent.filePath!)}>
                    Confirm delete
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Tooltip label="Delete agent file" withArrow>
                  <button
                    type="button"
                    className="icon-btn hover:text-err-fg"
                    onClick={() => setConfirmDelete(true)}
                    aria-label="Delete agent"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )
            )}
            {isEditable && (
              <Button
                size="xs"
                variant="primary"
                disabled={!canSave}
                loading={busy}
                leftSection={<Check className="w-3 h-3" />}
                onClick={() => void handleSave()}
              >
                {creating ? 'Create agent' : dirty ? 'Save changes' : 'Saved'}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={handleViewChange}
            options={[
              { value: 'config', label: 'Definition', icon: <FileText className="w-3 h-3" /> },
              {
                value: 'tools',
                label: 'Tools',
                icon: <Wrench className="w-3 h-3" />,
                count: disabledRulesCount > 0 ? `${disabledRulesCount} off` : undefined
              },
              ...(isEditable ? [{ value: 'raw' as const, label: 'Raw .md', icon: <Code2 className="w-3 h-3" /> }] : [])
            ]}
          />
          {!creating && agent?.filePath && (
            <span className="font-mono text-[11px] text-ink-4 truncate max-w-xs" title={agent.filePath}>
              {agent.locationLabel}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      {view === 'tools' ? (
        <AgentToolsEditor
          agent={{
            id: draft.id || agent?.id || 'new-agent',
            sourceKind: creating ? 'markdown' : agent!.sourceKind,
            tools: draft.tools,
            resolvedTools: agent?.resolvedTools
          }}
          toolInventory={toolInventory}
          agentToolPolicy={agentToolPolicy}
          toolsLoading={toolsLoading}
          busy={busy}
          onToggleRule={handleToggleRule}
          onResetAll={handleResetTools}
        />
      ) : view === 'raw' && isEditable ? (
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
          <div className="p-4 pb-16 flex flex-col gap-3.5 max-w-5xl mx-auto">
            {!isEditable && (
              <Banner tone="neutral">
                {agent?.sourceKind === 'builtin'
                  ? 'Built-in OpenCode agent. Toggle its tools in the Tools tab, or click Clone to customize it as a markdown agent.'
                  : 'Defined in opencode.json. Toggle its tools in the Tools tab, or click Clone to customize it as a markdown agent.'}
              </Banner>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_310px] gap-4 items-start">
              {/* Main Canvas: System Prompt + Tool Access Summary */}
              <div className="flex flex-col gap-3.5 min-w-0">
                <Surface
                  level="s1"
                  radius="lg"
                  className="overflow-hidden flex flex-col focus-within:border-acc-bd focus-within:shadow-[0_0_0_3px_var(--acc-bg)]"
                >
                  <div className="flex items-center justify-between px-3.5 py-2 border-b border-line bg-surface-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink">System prompt</span>
                      <span className="font-mono text-[11px] text-ink-4">{promptLines} ln</span>
                    </div>
                    <SegmentedControl
                      size="xs"
                      value={promptMode}
                      onChange={setPromptMode}
                      options={[
                        { value: 'edit', label: 'Edit', icon: <Pencil className="w-3 h-3" /> },
                        { value: 'preview', label: 'Preview', icon: <Eye className="w-3 h-3" /> }
                      ]}
                    />
                  </div>
                  {promptMode === 'preview' ? (
                    <div className="p-4 min-h-[260px]">
                      {draft.prompt.trim() ? (
                        <Markdown>{draft.prompt}</Markdown>
                      ) : (
                        <p className="m-0 text-xs text-ink-4 italic">No system prompt yet.</p>
                      )}
                    </div>
                  ) : (
                    <Textarea
                      variant="unstyled"
                      placeholder="You are a focused specialist…"
                      minRows={12}
                      maxRows={26}
                      autosize
                      value={draft.prompt}
                      disabled={!isEditable}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setDraft((prev) => ({ ...prev, prompt: val, rawEdited: false }));
                      }}
                      className="px-3.5 py-3"
                      styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6 } }}
                    />
                  )}
                </Surface>

                <Surface level="s1" radius="lg" className="px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Wrench className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                    <span className="text-xs text-ink-2">
                      {effectiveToolEntries.length === 0
                        ? 'Inherits all session tools'
                        : disabledRulesCount > 0
                          ? `${disabledRulesCount} tool rule${disabledRulesCount === 1 ? '' : 's'} disabled`
                          : `${effectiveToolEntries.length} tool rule${effectiveToolEntries.length === 1 ? '' : 's'} configured`}
                    </span>
                    {effectiveToolEntries.slice(0, 5).map(([rule, on]) => (
                      <Chip key={rule} tone={on ? 'run' : 'err'} className="font-mono">
                        {rule}: {on ? 'on' : 'off'}
                      </Chip>
                    ))}
                    {effectiveToolEntries.length > 5 && (
                      <span className="text-[11px] text-ink-4">+{effectiveToolEntries.length - 5} more</span>
                    )}
                  </div>
                  <Button size="xs" variant="secondary" onClick={() => setView('tools')}>
                    Configure tools
                  </Button>
                </Surface>
              </div>

              {/* Right Inspector: Identity, Location, Model & Advanced */}
              <div className="flex flex-col gap-3 min-w-0">
                <Surface level="s1" radius="lg" className="p-3.5 flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ink-2">Agent ID</span>
                    <input
                      type="text"
                      placeholder="code-reviewer"
                      value={draft.id}
                      disabled={!isEditable}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setDraft((prev) => ({ ...prev, id: val, idTouched: true, rawEdited: false }));
                      }}
                      onBlur={() => {
                        if (creating && !draft.idTouched && draft.description) {
                          setDraft((prev) => ({ ...prev, id: slugifyAgentId(prev.description) }));
                        }
                      }}
                      className={`${FIELD_INPUT} font-mono`}
                    />
                    {draft.id && !idValid && (
                      <span className="text-[11px] text-err-fg">Use letters, digits, ., _, -, or /</span>
                    )}
                  </label>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium text-ink-2">Location</span>
                      <span className="font-mono text-[10.5px] text-ink-4">
                        {draft.scope === 'project' ? '.opencode/agents' : '~/.config/opencode'}
                      </span>
                    </div>
                    {isEditable ? (
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
                    ) : (
                      <span className="font-mono text-xs text-ink-3 py-1">{agent?.locationLabel}</span>
                    )}
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ink-2">Description</span>
                    <textarea
                      rows={2}
                      placeholder="Reviews diffs for bugs and security issues without editing files"
                      value={draft.description}
                      disabled={!isEditable}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setDraft((prev) => ({ ...prev, description: val, rawEdited: false }));
                      }}
                      className="w-full p-2.5 rounded-lg border border-line bg-surface-2 text-ink text-[12px] leading-snug placeholder:text-ink-4 focus:outline-none focus:border-acc-bd resize-y disabled:opacity-60"
                    />
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ink-2">Mode</span>
                    <SegmentedControl
                      size="sm"
                      fullWidth
                      value={draft.mode === 'primary' || draft.mode === 'subagent' ? draft.mode : 'all'}
                      onChange={(val) => isEditable && setDraft((prev) => ({ ...prev, mode: val, rawEdited: false }))}
                      options={[
                        { value: 'all', label: 'All' },
                        { value: 'primary', label: 'Primary' },
                        { value: 'subagent', label: 'Subagent' }
                      ]}
                    />
                  </div>

                  <Select
                    size="xs"
                    label="Model override"
                    value={draft.model || DEFAULT_MODEL}
                    disabled={!isEditable}
                    searchable
                    allowDeselect={false}
                    data={modelData}
                    onChange={(val) =>
                      setDraft((prev) => ({
                        ...prev,
                        model: !val || val === DEFAULT_MODEL ? '' : val,
                        rawEdited: false
                      }))
                    }
                  />
                </Surface>

                {isEditable && (
                  <Surface level="s1" radius="lg" className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((o) => !o)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 bg-transparent border-0 text-left cursor-pointer hover:bg-s3h"
                    >
                      <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
                        <Sliders className="w-3.5 h-3.5 text-ink-3" />
                        Advanced options
                      </span>
                      {advancedOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-ink-3" />
                      )}
                    </button>
                    <Collapse in={advancedOpen}>
                      <div className="px-3.5 pb-3.5 pt-2.5 border-t border-line flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-2.5">
                          <NumberInput
                            size="xs"
                            label="Temperature"
                            placeholder="default"
                            min={0}
                            max={2}
                            step={0.1}
                            decimalScale={2}
                            value={draft.temperature}
                            onChange={(val) =>
                              setDraft((prev) => ({
                                ...prev,
                                temperature: typeof val === 'number' ? val : '',
                                rawEdited: false
                              }))
                            }
                          />
                          <NumberInput
                            size="xs"
                            label="Max steps"
                            placeholder="unlimited"
                            min={1}
                            step={1}
                            allowDecimal={false}
                            value={draft.steps}
                            onChange={(val) =>
                              setDraft((prev) => ({
                                ...prev,
                                steps: typeof val === 'number' ? val : '',
                                rawEdited: false
                              }))
                            }
                          />
                        </div>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11.5px] font-medium text-ink-2">Color</span>
                          <input
                            type="text"
                            placeholder="#ff6b6b or accent"
                            value={draft.color}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setDraft((prev) => ({ ...prev, color: val, rawEdited: false }));
                            }}
                            className={FIELD_INPUT}
                          />
                        </label>
                        <div className="flex flex-col gap-2">
                          <Switch
                            size="xs"
                            label="Hide from @ autocomplete"
                            checked={draft.hidden}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setDraft((prev) => ({ ...prev, hidden: checked, rawEdited: false }));
                            }}
                          />
                          <Switch
                            size="xs"
                            label="Disable agent"
                            checked={draft.disabled}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setDraft((prev) => ({ ...prev, disabled: checked, rawEdited: false }));
                            }}
                          />
                        </div>
                      </div>
                    </Collapse>
                  </Surface>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
