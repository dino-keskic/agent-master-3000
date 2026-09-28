import fs from 'fs';
import os from 'os';
import path from 'path';
import { BoardState, GlobalSettings } from '../../shared/types.js';
import { cloneDefaultColumns, sanitizeColumns } from '../../shared/board/columns.js';
import { DEFAULT_PERMISSION_MODE } from '../../shared/agent/permissions.js';
import { normalizeBoardState } from '../../shared/board/normalize.js';
import { dataDir } from '../app/appPaths.js';
import {
  boardDocument,
  changedTranscripts,
  orphanedTranscripts,
  transcriptFileName,
  transcriptTaskId,
  WrittenLogs
} from '../../shared/board/persistence.js';

/**
 * The board on disk: one JSON document for the board, and a folder next to it
 * (`board_state.json.logs/`) with one transcript file per task.
 *
 * The document is small and rewritten on every change. A transcript is only
 * rewritten when its own task's log changed, and on a slower beat, because a
 * streaming turn changes it several times a second and a lost second of it is
 * recoverable from OpenCode's history. Every write goes through a temp file
 * and a rename so a crash mid-write cannot leave half a file behind.
 *
 * A board from before the split carries its transcripts inline; it is read as
 * it is and written back split on load.
 */

export const DEFAULT_FILE_PATH = defaultFilePath(process.env);

/**
 * Where the board lives unless told otherwise. Under `node --test` (which sets
 * NODE_TEST_CONTEXT) that is never the real board: anything that loads the
 * shared store in a test would otherwise read the user's board and save test
 * tasks into it.
 */
export function defaultFilePath(env: NodeJS.ProcessEnv): string {
  if (env.BOARD_STATE_FILE) return path.resolve(process.cwd(), env.BOARD_STATE_FILE);
  if (env.NODE_TEST_CONTEXT) return path.join(os.tmpdir(), `agent-master-3000-test-${process.pid}.json`);
  return path.join(dataDir(env), 'board_state.json');
}
const SAVE_DEBOUNCE_MS = 500;
/**
 * The closest two document writes get. A change someone asked for is written
 * at once when the file is quiet, but sixty turns starting together flip run
 * state a few hundred times a second, and each of those rewrote the whole
 * document; now a burst like that is one write now and one at the end of it.
 */
const MIN_WRITE_GAP_MS = 100;
/** Transcripts are written on their own, slower beat; see the class comment. */
const LOG_SAVE_DEBOUNCE_MS = 2000;

const DEFAULT_SETTINGS: GlobalSettings = {
  defaultModel: 'github-copilot/claude-sonnet-4.6',
  defaultAgent: '',
  defaultThinkingLevel: 'default',
  defaultPermissionMode: DEFAULT_PERMISSION_MODE,
  // No project until the user picks one (see shared/setup/onboarding.ts). Home, not
  // the folder the server started in: installed, that is wherever the shell was.
  defaultCwd: os.homedir(),
  projects: [],
  columns: cloneDefaultColumns()
};

function emptyState(): BoardState {
  return {
    tasks: [],
    settings: { ...DEFAULT_SETTINGS, projects: [], columns: cloneDefaultColumns() },
    nextTaskNumber: 0
  };
}

export class BoardStateFile {
  private readonly filePath: string;
  private readonly logDir: string;
  private state: BoardState = emptyState();
  private saveTimer: NodeJS.Timeout | null = null;
  /** When `saveTimer` fires; a debounced timer is pulled in for an immediate save. */
  private saveDue = 0;
  private lastWrite = 0;
  private logTimer: NodeJS.Timeout | null = null;
  /** Each task's transcript as it was last read or written, to skip the unchanged ones. */
  private readonly written: WrittenLogs = new Map();

  constructor(customFilePath?: string) {
    this.filePath = customFilePath || DEFAULT_FILE_PATH;
    this.logDir = `${this.filePath}.logs`;
    const parentDir = path.dirname(this.filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  /**
   * Reads the board, repairs it, and keeps the result as the state every later
   * save writes. An unreadable file is backed up rather than overwritten —
   * whatever is wrong with it, it is the only copy of the user's board.
   */
  public load(): BoardState {
    if (!fs.existsSync(this.filePath)) {
      const initial = emptyState();
      normalizeBoardState(initial);
      this.state = initial;
      this.write(initial);
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const projects = Array.isArray(parsed.settings?.projects) ? parsed.settings.projects : [];

      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const inline = this.attachTranscripts(tasks);
      const loaded: BoardState = {
        tasks,
        settings: {
          ...DEFAULT_SETTINGS,
          ...parsed.settings,
          projects,
          columns: sanitizeColumns(parsed.settings?.columns)
        },
        nextTaskNumber: parsed.nextTaskNumber
      };

      this.state = loaded;
      const repaired = normalizeBoardState(loaded);
      if (inline) {
        // A board from before the split is written back split straight away,
        // so the next run-state flip is not the one that pays for it. The
        // original is kept once, and the document is only rewritten without
        // its transcripts when every one of them made it to disk.
        this.backupOnce(`${this.filePath}.pre-split`);
        if (this.writeTranscripts()) this.write(loaded);
      } else if (repaired) {
        this.write(loaded);
      }
      // A document with no task list is not an empty board; its transcripts stay.
      if (Array.isArray(parsed.tasks)) this.removeOrphanedTranscripts();
      return loaded;
    } catch (e) {
      console.error('[Store] Error reading board_state.json — leaving the file untouched:', e);
      const backup = `${this.filePath}.error-${Date.now()}`;
      try { fs.copyFileSync(this.filePath, backup); } catch { /* ignore */ }
      const recovered = emptyState();
      normalizeBoardState(recovered);
      this.state = recovered;
      return recovered;
    }
  }

  /**
   * Gives each task its transcript: inline for a board written before the
   * split, otherwise from its file. Returns whether any were inline. A missing
   * or unreadable transcript is an empty one — the board is still usable, and
   * OpenCode still has the session.
   */
  private attachTranscripts(tasks: BoardState['tasks']): boolean {
    let inline = false;
    for (const task of tasks) {
      if (Array.isArray(task.logs)) {
        inline = true;
        continue;
      }
      task.logs = this.readTranscript(task.id);
      this.written.set(task.id, [...task.logs]);
    }
    return inline;
  }

  private readTranscript(taskId: string): BoardState['tasks'][number]['logs'] {
    const file = path.join(this.logDir, transcriptFileName(taskId));
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
      console.warn(`[Store] Transcript for ${taskId} is not a list; starting it empty`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      console.warn(`[Store] Transcript for ${taskId} is unreadable; starting it empty:`, e);
      try { fs.copyFileSync(file, `${file}.error-${Date.now()}`); } catch { /* ignore */ }
    }
    return [];
  }

  /**
   * Persists the state. `immediate` writes now unless the document was written
   * in the last MIN_WRITE_GAP_MS, and then as soon as that gap is up; otherwise
   * the write is debounced. Transcripts always ride their own slower timer, and
   * `flush` is what writes everything now.
   */
  public save(immediate = false): void {
    this.scheduleTranscripts();
    const now = Date.now();
    if (immediate && now - this.lastWrite >= MIN_WRITE_GAP_MS) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.write(this.state);
      return;
    }
    const due = immediate ? Math.max(now, this.lastWrite + MIN_WRITE_GAP_MS) : now + SAVE_DEBOUNCE_MS;
    if (this.saveTimer) {
      if (this.saveDue <= due) return;
      clearTimeout(this.saveTimer);
    }
    this.saveDue = due;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write(this.state);
    }, due - now);
  }

  private scheduleTranscripts(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      this.writeTranscripts();
    }, LOG_SAVE_DEBOUNCE_MS);
    // Never what keeps a process alive: shutdown and `exit` flush it.
    this.logTimer.unref();
  }

  /**
   * Writes now, on the way out. An empty board over a file that has tasks in it
   * is refused: that shape means something failed to load, and the file is the
   * only copy. A write already queued is a change someone made, so it goes out.
   */
  public flush(): void {
    if (this.state.tasks.length === 0 && !this.saveTimer && fs.existsSync(this.filePath)) {
      try {
        const onDisk = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(onDisk.tasks) && onDisk.tasks.length > 0) {
          console.warn('[Store] Refusing to flush an empty board over a non-empty file');
          return;
        }
      } catch { /* ignore */ }
    }
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = null;
    }
    // Transcripts first: a board document that names a task whose transcript
    // is not written yet reads back as an empty log, never as a broken board.
    this.writeTranscripts();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.write(this.state);
  }

  private backupOnce(backup: string): void {
    if (fs.existsSync(backup)) return;
    try { fs.copyFileSync(this.filePath, backup); } catch (e) {
      console.warn('[Store] Could not keep a copy of the board before splitting it:', e);
    }
  }

  /**
   * Every transcript that changed since it was last written, and none that did
   * not. Returns whether all of them were written.
   */
  private writeTranscripts(): boolean {
    const changed = changedTranscripts(this.state.tasks, this.written);
    if (changed.length > 0) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (e) {
        console.error('[Store] Failed to create the transcript folder:', e);
        return false;
      }
    }
    let ok = true;
    for (const task of changed) {
      if (atomicWrite(path.join(this.logDir, transcriptFileName(task.id)), JSON.stringify(task.logs))) {
        this.written.set(task.id, [...task.logs]);
      } else {
        ok = false;
      }
    }
    // A task that left the board takes its transcript with it.
    for (const taskId of orphanedTranscripts(this.state.tasks, this.written.keys())) {
      this.written.delete(taskId);
      try { fs.unlinkSync(path.join(this.logDir, transcriptFileName(taskId))); } catch { /* ignore */ }
    }
    return ok;
  }

  /**
   * Transcript files on disk for tasks the board no longer has — left behind
   * by a crash between deleting a task and the next transcript write. Only
   * ever called after a successful load, when the task list is known good.
   */
  private removeOrphanedTranscripts(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.logDir);
    } catch {
      return;
    }
    const byTask = new Map<string, string>();
    for (const name of names) {
      const taskId = transcriptTaskId(name);
      if (taskId) byTask.set(taskId, name);
    }
    for (const taskId of orphanedTranscripts(this.state.tasks, byTask.keys())) {
      try { fs.unlinkSync(path.join(this.logDir, byTask.get(taskId)!)); } catch { /* ignore */ }
    }
  }

  private write(data: BoardState): void {
    this.lastWrite = Date.now();
    atomicWrite(this.filePath, JSON.stringify(boardDocument(data)));
  }
}

/** Temp file and rename, so a reader never sees half a file. */
function atomicWrite(file: string, contents: string): boolean {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, contents, 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error(`[Store] Failed to save ${path.basename(file)}:`, e);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}
