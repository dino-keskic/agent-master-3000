import { PermissionMode } from '../types.js';
import { PERMISSION_MODES } from '../agent/permissions.js';
import { shortModelLabel } from '../format.js';

/**
 * How a turn will run, in one line: "opus-5.5 · build · medium · review writes".
 *
 * The composer used to spend a row of four pickers on settings that are right
 * nine times out of ten. They are folded into this line, which opens the
 * pickers when it is clicked.
 */

export interface RunSettings {
  model: string;
  /** The catalog's name for the model, when it is known. */
  modelName?: string;
  agent: string;
  thinkingLevel: string;
  permissionMode: PermissionMode;
}

export function runSummaryParts(settings: RunSettings): string[] {
  const permission = PERMISSION_MODES.find((mode) => mode.value === settings.permissionMode);
  const thinking = settings.thinkingLevel && settings.thinkingLevel !== 'default' ? settings.thinkingLevel : undefined;
  return [
    settings.model ? shortModelLabel(settings.model, settings.modelName) : 'default model',
    settings.agent || undefined,
    thinking,
    permission?.label.toLowerCase()
  ].filter((part): part is string => !!part);
}

export function runSummary(settings: RunSettings): string {
  return runSummaryParts(settings).join(' · ');
}
