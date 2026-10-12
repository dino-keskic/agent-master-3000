import { OpenCodeAgent } from '../sessions/types.js';

/** Agents that only research or critique — never the default for a board task. */
const RESEARCH_ONLY = /ask|review/i;

/** Names worth preferring, in order, when the current pick is unusable. */
const PREFERRED = ['Local', 'plan', 'CEO'];

/**
 * `wanted` as OpenCode lists it, ignoring case.
 *
 * OpenCode 1.x named an agent by its file's frontmatter `name:`; 2.x names it
 * by the file name and ignores `name:`, so `agents/ceo.md` with `name: CEO` is
 * "CEO" to a task saved on 1.x and "ceo" to the agent running it now.
 */
export function findAgentName(names: readonly string[], wanted: string | undefined): string | undefined {
  if (!wanted) return undefined;
  if (names.includes(wanted)) return wanted;
  const lower = wanted.toLowerCase();
  return names.find((name) => name.toLowerCase() === lower);
}

/**
 * What to send OpenCode for an agent its list does not name, best guess first.
 *
 * The list can be short of agents that exist: OpenCode 2 answers a folder's
 * first session before it has read that folder's agent files. So the board
 * still tries — as written, then as the lower-case file name 2.x would use.
 */
export function agentIdGuesses(requested: string): string[] {
  const lower = requested.toLowerCase();
  return lower === requested ? [requested] : [requested, lower];
}

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
  const listed = findAgentName(names, current);
  if (listed && !RESEARCH_ONLY.test(listed)) return listed;

  for (const preferred of PREFERRED) {
    const found = findAgentName(names, preferred);
    if (found) return found;
  }

  const coding = agents.find((a) => !RESEARCH_ONLY.test(a.name) && /local|^coder$|build/i.test(a.name));
  if (coding) return coding.name;

  const notAsk = agents.find((a) => !RESEARCH_ONLY.test(a.name));
  if (notAsk) return notAsk.name;

  // Everything on offer is research-only: honour the explicit choice, else take
  // whatever exists rather than handing back an empty agent name.
  if (listed) return listed;
  return names[0] || '';
}
