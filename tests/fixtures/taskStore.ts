import fs from 'fs';
import os from 'os';
import path from 'path';
import { TaskStore } from '../../server/board/taskStore.js';

/**
 * A store of its own per test file, on its own file, so no test inherits
 * another's tasks and the order they run in stops mattering.
 */

/**
 * Where test boards are written: a temp folder per test process, never the
 * repo's `data/`, which is where a developer's real board lives (and which a
 * container built from the repo does not have).
 */
export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-master-3000-tests-'));
process.on('exit', () => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

export interface StoreFixture {
  store: TaskStore;
  /** Where it persists — the tests that reload it from disk need this. */
  file: string;
  /** Delete the file and its transcripts. Pass this to `after()`. */
  cleanup: () => void;
}

export function freshStore(name: string): StoreFixture {
  const file = boardFile(name);
  const cleanup = () => {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  };
  cleanup();
  return { store: new TaskStore(file), file, cleanup };
}

export function boardFile(name: string): string {
  return path.join(TEST_DATA_DIR, `test_${name}_board_state.json`);
}

/** A board file written by hand, to see what the store makes of it on load. */
export function writeBoardFile(name: string, tasks: unknown[], nextTaskNumber: number): string {
  const file = boardFile(name);
  fs.writeFileSync(
    file,
    JSON.stringify({
      nextTaskNumber,
      settings: {
        defaultModel: 'x',
        defaultAgent: '',
        defaultThinkingLevel: 'default',
        defaultCwd: '/tmp',
        projects: []
      },
      tasks
    })
  );
  return file;
}

/** A task row as an older board wrote it: a `status`, and no `columnId`. */
export function legacyTask(id: string, title: string, status: string, createdAt = 1): Record<string, unknown> {
  return {
    id,
    title,
    prompt: 'p',
    description: 'p',
    status,
    model: 'x',
    agent: 'a',
    thinkingLevel: 'default',
    cwd: '/tmp',
    createdAt,
    updatedAt: createdAt,
    logs: []
  };
}
