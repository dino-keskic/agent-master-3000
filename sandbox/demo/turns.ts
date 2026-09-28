import { DemoModel } from './models.js';
import { Turn } from './opencodeDb.js';
import { ScriptedTurn } from './tasks.js';

/**
 * A session's turns: generated working turns (read, edit, test) spread over
 * its lifetime, then its scripted tail. Token counts grow the way a real
 * conversation's context does, so cost and occupancy come out believable.
 * Seeded, so the board looks the same every time it is rebuilt.
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THOUGHTS = [
  'Checking how {file} is used before changing its signature.',
  'The tests for {file} mock the HTTP client; the new behaviour needs a case for the error path too.',
  'Reading {file} to see where the old behaviour is still assumed.',
  'This touches {file}; running the narrow test set first keeps the loop fast.'
];

const REPLIES = [
  'Updated `{file}` and its tests. Nothing else depended on the old shape.',
  'Refactored `{file}`; behaviour is unchanged and the tests still pass.',
  'Found one more caller in `{file}` and moved it over.',
  'Typecheck is clean after the change to `{file}`.'
];

const FOLLOW_UPS = [
  'Keep the public API the same, please.',
  'Can you also cover the error path?',
  'Run the tests again.',
  'What else still uses the old version?'
];

function pick<T>(list: readonly T[], r: () => number): T {
  return list[Math.floor(r() * list.length)]!;
}

function tokensFor(model: DemoModel, index: number, r: () => number): Turn['tokens'] {
  const cacheRead = Math.min(Math.floor(model.context * 0.55), 16_000 + index * (7_000 + Math.floor(r() * 5_000)));
  const input = 1_500 + Math.floor(r() * 9_000);
  return {
    input,
    cacheRead,
    cacheWrite: model.cacheWrite > 0 ? Math.floor(input * 0.6) : 0,
    output: 350 + Math.floor(r() * 3_200),
    reasoning: 150 + Math.floor(r() * 2_400)
  };
}

export interface TurnPlan {
  model: DemoModel;
  count: number;
  /** Epoch ms of the first and last turn. */
  from: number;
  to: number;
  prompt?: string;
  files: string[];
  testCmd: string;
  tail?: ScriptedTurn[];
  seed: number;
}

export function buildTurns(plan: TurnPlan): Turn[] {
  const r = rng(plan.seed);
  const files = plan.files.length > 0 ? plan.files : ['src/index.ts'];
  const tail = plan.tail ?? [];
  const generated = Math.max(0, plan.count - tail.length);
  const span = Math.max(1, plan.to - plan.from);
  const at = (i: number) => Math.round(plan.from + (span * i) / Math.max(1, plan.count - 1));
  const turns: Turn[] = [];

  for (let i = 0; i < generated; i++) {
    const file = pick(files, r);
    const fill = (s: string) => s.replace('{file}', file);
    const tools = [
      { tool: 'read', input: { filePath: file }, output: `(${40 + Math.floor(r() * 180)} lines)` },
      ...(r() > 0.4 ? [{ tool: 'edit', input: { filePath: file }, output: `Edited ${file} (+${1 + Math.floor(r() * 30)} −${Math.floor(r() * 12)})` }] : []),
      ...(plan.testCmd && r() > 0.5
        ? [{ tool: 'bash', input: { command: plan.testCmd, description: 'Run the tests' }, output: `Tests  ${20 + Math.floor(r() * 90)} passed` }]
        : [])
    ];
    turns.push({
      at: at(i),
      user: i === 0 ? plan.prompt : r() > 0.7 ? pick(FOLLOW_UPS, r) : undefined,
      reasoning: fill(pick(THOUGHTS, r)),
      tools,
      reply: fill(pick(REPLIES, r)),
      tokens: tokensFor(plan.model, i, r)
    });
  }
  tail.forEach((scripted, j) => {
    const i = generated + j;
    turns.push({
      at: at(i),
      user: scripted.user ?? (i === 0 ? plan.prompt : undefined),
      reasoning: scripted.reasoning,
      tools: scripted.tools,
      reply: scripted.reply,
      tokens: tokensFor(plan.model, i, r)
    });
  });
  return turns;
}
