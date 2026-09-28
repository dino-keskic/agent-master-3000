import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { DemoModel } from './models.js';

/**
 * Writes the demo's OpenCode database: projects, sessions, and each turn as the
 * `message` and `part` rows OpenCode itself writes. The board reads cost,
 * tokens, context and transcripts straight out of these, so the numbers on
 * screen are the board's own arithmetic over them, not values typed into a
 * card. The schema is the one `tests/fixtures/opencodeDb.ts` mirrors.
 */

const SCHEMA = `
  CREATE TABLE project (
    id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT, icon_url TEXT, icon_color TEXT,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_initialized INTEGER, sandboxes TEXT NOT NULL
  );
  CREATE TABLE project_directory (
    project_id TEXT NOT NULL, directory TEXT NOT NULL, type TEXT, strategy TEXT, time_created INTEGER NOT NULL,
    PRIMARY KEY (project_id, directory)
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
    slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
    summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER,
    agent TEXT, model TEXT, cost REAL NOT NULL DEFAULT 0,
    tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning INTEGER NOT NULL DEFAULT 0, tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX message_session_idx ON message (session_id, time_created);
  CREATE INDEX part_message_idx ON part (message_id);
  CREATE INDEX part_session_idx ON part (session_id);
`;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let counter = 0;

/** An id the way OpenCode makes one — sortable by time, then 14 base62 characters. */
export function openCodeId(prefix: string, ms: number): string {
  counter += 1;
  const hex = (BigInt(ms) * 0x1000n + BigInt(counter % 0x1000)).toString(16).padStart(12, '0');
  const bytes = crypto.createHash('sha1').update(`${prefix}${ms}${counter}`).digest();
  let tail = '';
  for (let i = 0; i < 14; i++) tail += BASE62[bytes[i]! % 62];
  return `${prefix}_${hex}${tail}`;
}

export interface ToolPart {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  title?: string;
}

/** One exchange: an optional user message, then the assistant's work and reply. */
export interface Turn {
  at: number;
  user?: string;
  reasoning?: string;
  tools?: ToolPart[];
  reply?: string;
  /** Fresh input, cache reads, output and reasoning tokens this turn processed. */
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number };
}

export interface SessionSpec {
  id: string;
  projectId: string;
  parentId?: string;
  directory: string;
  title: string;
  model: DemoModel;
  agent: string;
  variant: string;
  summary?: { files: number; additions: number; deletions: number };
  turns: Turn[];
}

export function turnCost(model: DemoModel, t: Turn['tokens']): number {
  return (
    (t.input * model.input +
      (t.output + t.reasoning) * model.output +
      t.cacheRead * model.cacheRead +
      t.cacheWrite * model.cacheWrite) /
    1e6
  );
}

export class DemoDb {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  project(id: string, worktree: string, createdAt: number, extraDirs: string[] = []): void {
    this.db
      .prepare(`INSERT INTO project (id, worktree, vcs, name, time_created, time_updated, sandboxes) VALUES (?, ?, 'git', NULL, ?, ?, '[]')`)
      .run(id, worktree, createdAt, createdAt);
    for (const dir of extraDirs) {
      this.db
        .prepare(`INSERT INTO project_directory (project_id, directory, type, strategy, time_created) VALUES (?, ?, 'worktree', 'git_worktree', ?)`)
        .run(id, dir, createdAt);
    }
  }

  /** Writes the session and every turn in it; returns what it cost. */
  session(spec: SessionSpec): number {
    const insertMessage = this.db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
    const insertPart = this.db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
    const part = (messageId: string, at: number, data: unknown) =>
      insertPart.run(openCodeId('prt', at), messageId, spec.id, at, at, JSON.stringify(data));
    const { model } = spec;
    const totals = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

    for (const turn of spec.turns) {
      let at = turn.at;
      if (turn.user) {
        const userId = openCodeId('msg', at);
        insertMessage.run(userId, spec.id, at, at, JSON.stringify({
          role: 'user', agent: spec.agent, model: { providerID: model.provider, modelID: model.id }, time: { created: at }
        }));
        part(userId, at, { type: 'text', text: turn.user });
        at += 1_500;
      }
      const cost = turnCost(model, turn.tokens);
      const t = turn.tokens;
      const assistantId = openCodeId('msg', at);
      const tools = turn.tools ?? [];
      const finished = at + 8_000 + tools.length * 6_000;
      insertMessage.run(assistantId, spec.id, at, finished, JSON.stringify({
        role: 'assistant',
        modelID: model.id,
        providerID: model.provider,
        agent: spec.agent,
        mode: spec.agent,
        variant: spec.variant,
        cost,
        tokens: {
          total: t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite,
          input: t.input, output: t.output, reasoning: t.reasoning,
          cache: { read: t.cacheRead, write: t.cacheWrite }
        },
        time: { created: at, completed: finished }
      }));
      part(assistantId, at, { type: 'step-start' });
      if (turn.reasoning) {
        part(assistantId, at + 200, { type: 'reasoning', text: turn.reasoning, time: { start: at + 200, end: at + 4_200 } });
      }
      tools.forEach((tool, i) => {
        const toolAt = at + 5_000 + i * 6_000;
        part(assistantId, toolAt, {
          type: 'tool', tool: tool.tool, callID: `call_${crypto.randomBytes(6).toString('hex')}`,
          state: { status: 'completed', input: tool.input, output: tool.output, title: tool.title ?? '', time: { start: toolAt, end: toolAt + 2_000 } }
        });
      });
      if (turn.reply) part(assistantId, finished - 500, { type: 'text', text: turn.reply });
      part(assistantId, finished, { type: 'step-finish', reason: 'stop', cost, tokens: { input: t.input, output: t.output } });

      totals.cost += cost;
      totals.input += t.input;
      totals.output += t.output;
      totals.reasoning += t.reasoning;
      totals.cacheRead += t.cacheRead;
      totals.cacheWrite += t.cacheWrite;
    }

    const first = spec.turns[0]?.at ?? Date.now();
    const last = spec.turns.at(-1)?.at ?? first;
    this.db.prepare(`
      INSERT INTO session (id, project_id, parent_id, slug, directory, title, version,
        summary_additions, summary_deletions, summary_files, time_created, time_updated,
        agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
      VALUES (?, ?, ?, ?, ?, ?, '1.18.32', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      spec.id, spec.projectId, spec.parentId ?? null,
      spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), spec.directory, spec.title,
      spec.summary?.additions ?? 0, spec.summary?.deletions ?? 0, spec.summary?.files ?? 0,
      first - 2_000, last + 30_000,
      spec.agent, JSON.stringify({ id: model.id, providerID: model.provider }),
      totals.cost, totals.input, totals.output, totals.reasoning, totals.cacheRead, totals.cacheWrite
    );
    return totals.cost;
  }

  close(): void {
    this.db.close();
  }
}
