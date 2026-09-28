import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cloneDefaultColumns } from '../../shared/board/columns.js';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/notifications/settings.js';
import { BoardState, BoardTask, TaskLink, TaskSessionLink } from '../../shared/types.js';
import { MODELS, ModelKey, boardModel, modelCatalog } from './models.js';
import { DemoDb, openCodeId } from './opencodeDb.js';
import { createRepos } from './repos.js';
import { HISTORY_TITLES, RepoKey, TASKS } from './tasks.js';
import { buildTurns, rng } from './turns.js';

/**
 * Seeds the sandbox with a board that looks lived in, for screenshots: three
 * repositories, a dozen tasks across the columns, and eight weeks of priced
 * OpenCode sessions behind them. Refuses to run outside the container — it
 * deletes and rewrites the OpenCode DB and board state it is pointed at.
 *
 *   npm run sandbox:demo     (seeds, starts the board, kicks off live turns)
 */

if (!fs.existsSync('/.dockerenv')) {
  console.error('[demo] Refusing to run outside the sandbox container.');
  process.exit(1);
}

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => Math.round(NOW - days * DAY);
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const dbFile = env('OPENCODE_DB');
const stateFile = env('BOARD_STATE_FILE');
const cacheDir = path.join(env('XDG_CACHE_HOME'), 'opencode');
const workspace = '/sandbox/workspace';

// --- repositories and OpenCode projects ---

const repos = createRepos(workspace);
const repoDir: Record<RepoKey, string> = {
  storefront: repos.storefront,
  payments: repos.payments,
  mobile: repos.mobile,
  pagination: repos.paginationWorktree
};
const projectOf: Record<RepoKey, 'storefront' | 'payments' | 'mobile'> = {
  storefront: 'storefront', payments: 'payments', mobile: 'mobile', pagination: 'storefront'
};
const projectId = (key: string) => crypto.createHash('sha1').update(`northwind/${key}`).digest('hex');

for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, stateFile]) fs.rmSync(file, { force: true });
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(cacheDir, 'models.json'), JSON.stringify(modelCatalog(), null, 2));

const db = new DemoDb(dbFile);
db.project(projectId('storefront'), repos.storefront, ago(60), [repos.paginationWorktree]);
db.project(projectId('payments'), repos.payments, ago(60));
db.project(projectId('mobile'), repos.mobile, ago(60));

// --- tasks and their sessions ---

const askSessions: string[] = [];
const liveTurns: { taskId: string; prompt: string }[] = [];

const tasks: BoardTask[] = TASKS.map((spec) => {
  const taskId = `TASK-${spec.number}`;
  const cwd = repoDir[spec.repo];
  const links: TaskSessionLink[] = [];
  const ids: Record<string, string> = {};

  for (const [i, session] of spec.sessions.entries()) {
    const modelKey: ModelKey = session.model ?? spec.model;
    const model = MODELS[modelKey]!;
    const agent = session.agent ?? spec.agent;
    const id = openCodeId('ses', ago(session.from));
    ids[session.key] = id;
    db.session({
      id,
      projectId: projectId(projectOf[spec.repo]),
      parentId: session.kind === 'subagent' ? ids.main : undefined,
      directory: cwd,
      title: session.title,
      model,
      agent,
      variant: spec.thinking,
      summary: session.summary,
      turns: buildTurns({
        model, count: session.turns, from: ago(session.from), to: ago(session.to),
        prompt: session.kind === 'main' || session.kind === 'stage' ? spec.prompt : undefined,
        files: spec.files, testCmd: spec.testCmd, tail: session.tail, seed: spec.number * 31 + i
      })
    });
    if (session.kind === 'subagent') continue;
    links.push({
      sessionId: id,
      title: session.title,
      kind: session.kind,
      createdAt: ago(session.from),
      updatedAt: ago(session.to),
      origin: session.kind === 'main' ? (links.length > 0 ? 'new' : 'initial') : session.kind === 'stage' ? 'stage' : undefined,
      stageColumnId: session.stageColumnId,
      chosen: { model: boardModel(modelKey), agent, thinkingLevel: spec.thinking },
      ...(session.kind === 'stage' ? { archivedAt: ago(session.to) } : {})
    });
  }

  const main = ids.main;
  if (spec.live && main) {
    if (spec.live.mode === 'ask') askSessions.push(main);
    liveTurns.push({ taskId, prompt: spec.live.prompt });
  }

  const taskLinks: TaskLink[] = (spec.links ?? []).map((link, i) => ({
    id: `link-${spec.number}-${i}`,
    url: link.url,
    title: link.title,
    kind: link.kind,
    ref: link.ref,
    source: 'agent',
    createdAt: ago(1),
    ...(link.state ? { status: { state: link.state, label: link.label ?? link.state, checkedAt: NOW } } : {})
  }));

  const lastActive = Math.min(...spec.sessions.map((s) => s.to), spec.createdDaysAgo);
  return {
    id: taskId,
    title: spec.title,
    titleLocked: true,
    description: '',
    prompt: spec.prompt,
    originalPrompt: spec.prompt,
    columnId: spec.columnId,
    lastRunColumnId: spec.sessions.length > 0 ? spec.columnId : undefined,
    runState: 'idle',
    model: boardModel(spec.model),
    agent: spec.agent,
    thinkingLevel: spec.thinking,
    sessionId: main,
    activeSessionId: main,
    sessions: links.length > 0 ? links : undefined,
    cwd,
    projectId: projectOf[spec.repo],
    createdAt: ago(spec.createdDaysAgo),
    updatedAt: ago(lastActive),
    logs: [],
    links: taskLinks.length > 0 ? taskLinks : undefined
  } satisfies BoardTask;
});

// --- past work, for the spend history ---

const r = rng(7);
for (let week = 0; week < 8; week++) {
  const perWeek = 3 + Math.floor(r() * 4);
  for (let n = 0; n < perWeek; n++) {
    const pick = HISTORY_TITLES[Math.floor(r() * HISTORY_TITLES.length)]!;
    const modelKey = (['opus', 'opus', 'sonnet', 'sonnet', 'gpt6', 'luna', 'gemini', 'qwen'] as const)[Math.floor(r() * 8)]!;
    const from = 12 + week * 7 + r() * 6;
    const to = Math.max(from - r() * 1.5, 10);
    const model = MODELS[modelKey]!;
    db.session({
      id: openCodeId('ses', ago(from)),
      projectId: projectId(projectOf[pick.repo]),
      directory: repoDir[pick.repo],
      title: pick.title,
      model,
      agent: r() > 0.8 ? 'plan' : 'build',
      variant: 'medium',
      summary: { files: 1 + Math.floor(r() * 9), additions: 10 + Math.floor(r() * 300), deletions: Math.floor(r() * 150) },
      turns: buildTurns({ model, count: 4 + Math.floor(r() * 20), from: ago(from), to: ago(to), prompt: pick.title, files: [], testCmd: 'pnpm test', seed: week * 100 + n })
    });
  }
}
db.close();

// --- the board ---

const state: BoardState = {
  tasks,
  nextTaskNumber: 124,
  settings: {
    defaultModel: boardModel('opus'),
    defaultAgent: 'build',
    defaultThinkingLevel: 'medium',
    defaultPermissionMode: 'review-writes',
    defaultCwd: repos.storefront,
    projects: [
      { id: 'storefront', name: 'storefront-web', path: repos.storefront, createdAt: ago(60) },
      { id: 'payments', name: 'payments-api', path: repos.payments, createdAt: ago(60) },
      { id: 'mobile', name: 'mobile-app', path: repos.mobile, createdAt: ago(60) }
    ],
    columns: cloneDefaultColumns(),
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS }
  }
};
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
fs.writeFileSync('/sandbox/demo.env', `ACP_FAKE_ASK_SESSIONS=${askSessions.join(',')}\n`);
fs.writeFileSync('/sandbox/demo-turns.json', JSON.stringify(liveTurns));
console.log(`[demo] Seeded ${tasks.length} tasks, OpenCode DB at ${dbFile}, board state at ${stateFile}.`);
