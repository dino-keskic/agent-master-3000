/**
 * The demo board's models: what each costs and how large its context is. The
 * same list goes into OpenCode's model catalog (so the board can show context
 * occupancy) and prices every seeded turn (so the costs add up the way a real
 * week would).
 */

export interface DemoModel {
  provider: string;
  id: string;
  name: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  context: number;
}

export const MODELS: Record<string, DemoModel> = {
  opus: { provider: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, context: 400_000 },
  sonnet: { provider: 'anthropic', id: 'claude-sonnet-5', name: 'Claude Sonnet 5', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, context: 1_000_000 },
  haiku: { provider: 'anthropic', id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, context: 200_000 },
  gpt6: { provider: 'openai', id: 'gpt-6', name: 'GPT-6', input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0, context: 400_000 },
  luna: { provider: 'openai', id: 'gpt-6-luna', name: 'GPT-6 Luna', input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0, context: 400_000 },
  gemini: { provider: 'google', id: 'gemini-3-pro', name: 'Gemini 3 Pro', input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0, context: 1_000_000 },
  qwen: { provider: 'ollama', id: 'qwen3-coder-30b', name: 'Qwen3 Coder 30B (local)', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 128_000 },
  devstral: { provider: 'ollama', id: 'devstral-2', name: 'Devstral 2 (local)', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 128_000 }
};

export type ModelKey = keyof typeof MODELS;

/** `provider/id`, the way the board stores a model. */
export function boardModel(key: ModelKey): string {
  const m = MODELS[key]!;
  return `${m.provider}/${m.id}`;
}

/** OpenCode's `models.json` shape: provider -> models -> price and limit. */
export function modelCatalog(): Record<string, { id: string; models: Record<string, unknown> }> {
  const out: Record<string, { id: string; models: Record<string, unknown> }> = {};
  for (const m of Object.values(MODELS)) {
    out[m.provider] ??= { id: m.provider, models: {} };
    out[m.provider]!.models[m.id] = {
      id: m.id,
      name: m.name,
      cost: { input: m.input, output: m.output, cache_read: m.cacheRead, cache_write: m.cacheWrite },
      limit: { context: m.context, output: 64_000 }
    };
  }
  return out;
}
