import { OpenCodeAgent } from '../sessions/types.js';

/** Agents that only research or critique — never the default for a board task. */
const RESEARCH_ONLY = /ask|review/i;

/** Names worth preferring, in order, when the current pick is unusable. */
const PREFERRED = ['Local', 'plan', 'CEO'];

/**
 * The agent a new task should run as.
 *
 * OpenCode installs ship wildly different mode lists, and several of them lead
 * with a read-only "Ask" mode — picking that leaves the user with an agent that
 * cannot write a file, which looks like the board is broken. So a research-only
 * mode is never chosen for someone, only kept when they asked for it themselves
 * and nothing else is available.
 */
export function pickDefaultAgent(agents: OpenCodeAgent[], current?: string): string {
  const names = agents.map((a) => a.name);
  if (current && names.includes(current) && !RESEARCH_ONLY.test(current)) return current;

  for (const preferred of PREFERRED) {
    if (names.includes(preferred)) return preferred;
  }

  const coding = agents.find((a) => !RESEARCH_ONLY.test(a.name) && /local|^coder$|build/i.test(a.name));
  if (coding) return coding.name;

  const notAsk = agents.find((a) => !RESEARCH_ONLY.test(a.name));
  if (notAsk) return notAsk.name;

  // Everything on offer is research-only: honour the explicit choice, else take
  // whatever exists rather than handing back an empty agent name.
  if (current && names.includes(current)) return current;
  return names[0] || '';
}
