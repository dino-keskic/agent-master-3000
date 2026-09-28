import { shortModelLabel } from '../format.js';

/** Who actually ran a turn — not the task's next-run defaults. */
export interface TurnAttribution {
  model?: string;
  agent?: string;
  thinkingLevel?: string;
}

export function turnAttributionFromMessage(data: unknown): TurnAttribution {
  if (!data || typeof data !== 'object') return {};
  const obj = data as Record<string, unknown>;
  const nested = obj.model && typeof obj.model === 'object' ? (obj.model as Record<string, unknown>) : undefined;
  const modelId =
    (typeof obj.modelID === 'string' && obj.modelID)
    || (typeof nested?.id === 'string' && nested.id)
    || (typeof nested?.modelID === 'string' && nested.modelID)
    || undefined;
  const provider =
    (typeof obj.providerID === 'string' && obj.providerID)
    || (typeof nested?.providerID === 'string' && nested.providerID)
    || (typeof nested?.provider === 'string' && nested.provider)
    || undefined;
  const model = modelId ? (provider ? `${provider}/${modelId}` : modelId) : undefined;
  const agent =
    (typeof obj.agent === 'string' && obj.agent)
    || (typeof obj.mode === 'string' && obj.mode)
    || undefined;
  const thinkingLevel = typeof obj.variant === 'string' && obj.variant ? obj.variant : undefined;
  return { model, agent, thinkingLevel };
}

export function formatTurnAttribution(attr: TurnAttribution | undefined): string | undefined {
  if (!attr) return undefined;
  const bits: string[] = [];
  if (attr.agent) bits.push(attr.agent);
  if (attr.model) bits.push(shortModelLabel(attr.model));
  if (attr.thinkingLevel && attr.thinkingLevel !== 'default' && attr.thinkingLevel !== 'none') {
    bits.push(attr.thinkingLevel);
  }
  return bits.length > 0 ? bits.join(' · ') : undefined;
}
