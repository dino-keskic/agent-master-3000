import { SpendMessage } from '../../shared/spend/messages.js';

/**
 * Spend rows and turns for the spend tests: an assistant `message` row the way
 * OpenCode writes one, a parsed turn with every field filled in, and a local
 * clock time that does not depend on the runner's zone.
 */


/** A `message` row shaped the way OpenCode writes assistant turns. */
export function row(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    role: 'assistant',
    cost: 0.0175,
    tokens: { total: 4496, input: 100, output: 40, reasoning: 10, cache: { read: 4346, write: 0 } },
    modelID: 'gpt-5.6-terra',
    providerID: 'github-copilot',
    agent: 'CEO',
    mode: 'CEO',
    variant: 'high',
    time: { created: 1, completed: 2 },
    ...overrides
  });
}

export function message(overrides: Partial<SpendMessage> = {}): SpendMessage {
  return {
    sessionId: 'ses_a',
    at: Date.UTC(2026, 0, 1),
    cost: 1,
    tokens: 100,
    model: 'github-copilot/kimi-k3',
    agent: 'build',
    project: 'agent-master-3000',
    ...overrides
  };
}

/** Local midnight n days back from a local noon, so no test depends on the runner's zone. */
export function localAt(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month, day, hour).getTime();
}
