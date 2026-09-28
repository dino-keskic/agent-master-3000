import os from 'os';
import path from 'path';
import { sanitizeColumns } from '../../shared/board/columns.js';
import { BoardColumn, BoardState, BoardTask, GlobalSettings, ProjectFolder } from '../../shared/types.js';
import { BoardStateFile } from './stateFile.js';

/**
 * The board document: the state in memory, its file, and the settings that
 * describe the board itself rather than any one task.
 *
 * `TaskStore` extends this, so everything that writes to a task has `state` and
 * `save()` to hand without a layer of forwarding methods in between.
 */
export class BoardDocument {
  private readonly file: BoardStateFile;
  protected readonly state: BoardState;

  constructor(customFilePath?: string) {
    this.file = new BoardStateFile(customFilePath);
    this.state = this.file.load();
  }

  /**
   * Persist. Immediate for anything a user or an API call asked for; debounced
   * for streaming writes, which arrive several times a second during a turn.
   */
  protected save(immediate = true): void {
    this.file.save(immediate);
  }

  /** Write now, on the way out. */
  public flush(): void {
    this.file.flush();
  }

  // --- reads ---

  public getBoardState(): BoardState {
    return this.state;
  }

  public getTasks(): BoardTask[] {
    return this.state.tasks;
  }

  public getTask(taskId: string): BoardTask | undefined {
    return this.state.tasks.find((task) => task.id === taskId);
  }

  public getSettings(): GlobalSettings {
    return this.state.settings;
  }

  public taskIdsInColumn(columnId: string): string[] {
    return this.state.tasks.filter((task) => task.columnId === columnId).map((task) => task.id);
  }

  // --- settings and projects ---

  /** Tasks left in a column that no longer exists fall back to the first one. */
  private rehomeOrphanedTasks(columns: BoardColumn[]): void {
    const validIds = new Set(columns.map((column) => column.id));
    const fallback = columns[0]?.id || 'backlog';
    for (const task of this.state.tasks) {
      if (validIds.has(task.columnId)) continue;
      task.columnId = fallback;
      task.updatedAt = Date.now();
    }
  }

  public updateSettings(patch: Partial<GlobalSettings>): GlobalSettings {
    const next: GlobalSettings = { ...this.state.settings, ...patch };
    if (patch.columns) {
      next.columns = sanitizeColumns(patch.columns);
      this.rehomeOrphanedTasks(next.columns);
    }
    this.state.settings = next;
    this.save();
    return this.state.settings;
  }

  /** Adding a folder already on the board just selects it again. */
  public addProject(name: string, folderPath: string): ProjectFolder {
    const existing = this.state.settings.projects.find((project) => project.path === folderPath);
    if (existing) return existing;

    const project: ProjectFolder = {
      id: `proj-${Date.now()}`,
      name: name || path.basename(folderPath) || 'Project',
      path: folderPath,
      createdAt: Date.now()
    };
    this.state.settings.projects.push(project);
    this.state.settings.selectedProjectId = project.id;
    this.state.settings.defaultCwd = folderPath;
    this.save();
    return project;
  }

  public deleteProject(projectId: string): boolean {
    const index = this.state.settings.projects.findIndex((project) => project.id === projectId);
    if (index === -1) return false;

    this.state.settings.projects.splice(index, 1);
    if (this.state.settings.selectedProjectId === projectId) {
      const fallback = this.state.settings.projects[0];
      this.state.settings.selectedProjectId = fallback?.id;
      this.state.settings.defaultCwd = fallback?.path || os.homedir();
    }
    this.save();
    return true;
  }
}
