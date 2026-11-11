import React, { useState } from 'react';
import { Group, Tooltip } from '@mantine/core';
import { ArrowUp, Bot, Brain, ChevronDown, Cpu, ListPlus, Loader2, ShieldCheck, Square } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { PermissionMode } from '../../../shared/types';
import { PERMISSION_MODES } from '../../../shared/agent/permissions';
import { shortModelLabel, thinkingLevelOptions } from '../../../shared/format';
import { modelOptionLabel } from '../../../shared/agent/modelScope';
import { useModelOptions } from '../../app/modelOptions';
import { runSummary } from '../../../shared/composer/runSummary';
import { InlineSelect } from '../ui/InlineSelect';

/**
 * The row under the box: how this turn will be run, and the button that runs
 * it — or, while one is running, the button that stops it.
 *
 * The four settings are right far more often than they are changed, so they
 * are one line (`runSummary`) that opens into the pickers when clicked.
 */

export type ComposerSubmitKind = 'dispatch' | 'queue' | 'send';

export interface TurnControlsProps {
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  thinkingLevel: string;
  onThinkingLevelChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (value: PermissionMode) => void;
  agent: string;
  onAgentChange: (value: string) => void;
  submitKind: ComposerSubmitKind;
  submitTooltip?: string;
  submitting: boolean;
  /** Nothing to send: empty box, already sending, or the composer is off. */
  idle: boolean;
  /** The mic, which sits just before the send button. */
  dictation?: React.ReactNode;
  /** Given while a turn is running: the one place it is stopped from. */
  onStop?: () => void;
}

export const TurnControls: React.FC<TurnControlsProps> = ({
  models,
  agents,
  thinkingLevel,
  onThinkingLevelChange,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  agent,
  onAgentChange,
  submitKind,
  submitTooltip,
  submitting,
  idle,
  dictation,
  onStop
}) => {
  const [open, setOpen] = useState(false);
  // The agents and thinking levels on offer belong to the model in this very
  // row, not to whatever the board defaults to.
  const options = useModelOptions(model);
  const listedModels = models.map((m) => ({ value: m.id, label: modelOptionLabel(m), keywords: m.id }));
  // Until the catalog loads — or when it lacks the task's model — the model in
  // use is still the model in use, not a missing one.
  const modelOptions =
    model && !listedModels.some((o) => o.value === model)
      ? [{ value: model, label: shortModelLabel(model), keywords: model }, ...listedModels]
      : listedModels;
  const agentOptions = (options.known ? options.agents : agents).map((a) => ({ value: a.name, label: a.name }));
  const permission = PERMISSION_MODES.find((m) => m.value === permissionMode);
  const summary = runSummary({
    model,
    modelName: models.find((m) => m.id === model)?.name,
    agent,
    thinkingLevel,
    permissionMode
  });

  return (
    <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
      {/* How the turn runs on the left, where the eye leaves the text; the
          button that runs it on the right, where the hand goes. */}
      <Group gap={4} wrap="wrap" className="min-w-0 flex-1">
        <button
          type="button"
          className="run-summary"
          aria-expanded={open}
          aria-label={`Run settings: ${summary}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {!open && <span className="truncate">{summary}</span>}
          {open && <span>Run settings</span>}
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (<>
        <InlineSelect
          label="Model"
          icon={<Cpu className="w-3.5 h-3.5" />}
          value={model}
          options={modelOptions}
          onChange={onModelChange}
          searchable
        />
        <InlineSelect
          label="Agent"
          icon={<Bot className="w-3.5 h-3.5" />}
          value={agent}
          options={agentOptions}
          onChange={onAgentChange}
        />
        <InlineSelect
          label="Thinking"
          icon={<Brain className="w-3.5 h-3.5" />}
          value={thinkingLevel}
          options={thinkingLevelOptions(options.effortLevels, { lowercase: true })}
          onChange={onThinkingLevelChange}
        />
        <InlineSelect
          label="Permissions"
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          value={permissionMode}
          options={PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))}
          onChange={(val) => onPermissionModeChange(val as PermissionMode)}
          title={permission?.description}
        />
        </>)}
      </Group>
      <Group gap={6} wrap="nowrap" className="shrink-0">
        {dictation}
        {onStop && (
          <Tooltip label="Stop this turn — the session is kept" withArrow>
            <button type="button" className="composer-stop" onClick={onStop}>
              <Square className="w-3 h-3 fill-current" />
              Stop
            </button>
          </Tooltip>
        )}
        <Tooltip
          label={submitTooltip || (submitKind === 'queue' ? 'Queue (⌘Enter)' : 'Send (⌘Enter)')}
          withArrow
        >
          <button
            type="submit"
            disabled={idle || submitting}
            aria-label={submitKind === 'queue' ? 'Queue' : 'Send'}
            // Nothing to send is a quiet grey, not a faded accent: the one blue
            // control in the composer should mean "this will go".
            className="w-8 h-8 rounded-lg bg-accent text-white hover:brightness-105 active:scale-95 disabled:bg-surface-2 disabled:text-ink-4 disabled:border disabled:border-line disabled:shadow-none disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100 flex items-center justify-center transition-all shadow-sm shrink-0"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : submitKind === 'queue' ? (
              <ListPlus className="w-4 h-4" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      </Group>
    </Group>
  );
};
