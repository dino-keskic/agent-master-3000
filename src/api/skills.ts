/** Skills: listing, creating/editing SKILL.md, and bundled skill files. */

import { SaveSkillInput, SkillFileInfo, SkillInventory, SkillItem } from '../../shared/skills/skills';
import { request } from './http';

function skillsUrl(
  taskId: string | undefined,
  suffix: string,
  sessionId?: string,
  cwd?: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams(extra);
  if (taskId) {
    if (sessionId) params.set('session', sessionId);
  } else if (cwd) {
    params.set('cwd', cwd);
  }
  const query = params.toString();
  const base = taskId ? `/api/tasks/${taskId}/skills${suffix}` : `/api/workspace/skills${suffix}`;
  return `${base}${query ? `?${query}` : ''}`;
}

export const skillsApi = {
  getTaskSkills: (taskId: string | undefined, sessionId?: string, cwd?: string) =>
    request<SkillInventory>(skillsUrl(taskId, '', sessionId, cwd)),

  saveTaskSkill: (taskId: string | undefined, input: SaveSkillInput, sessionId?: string, cwd?: string) =>
    request<{ skill: SkillItem; inventory: SkillInventory }>(skillsUrl(taskId, '', sessionId, cwd), {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  deleteTaskSkill: (taskId: string | undefined, dirPath: string, sessionId?: string, cwd?: string) =>
    request<{ inventory: SkillInventory }>(skillsUrl(taskId, '', sessionId, cwd), {
      method: 'DELETE',
      body: JSON.stringify({ dirPath })
    }),

  readSkillFile: (
    taskId: string | undefined,
    dirPath: string,
    relativePath: string,
    sessionId?: string,
    cwd?: string
  ) =>
    request<{ path: string; content: string }>(
      skillsUrl(taskId, '/file', sessionId, cwd, { dir: dirPath, path: relativePath })
    ),

  saveSkillFile: (
    taskId: string | undefined,
    payload: { dirPath: string; relativePath: string; content: string },
    sessionId?: string,
    cwd?: string
  ) =>
    request<{ files: SkillFileInfo[]; inventory: SkillInventory }>(skillsUrl(taskId, '/file', sessionId, cwd), {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),

  deleteSkillFile: (
    taskId: string | undefined,
    payload: { dirPath: string; relativePath: string },
    sessionId?: string,
    cwd?: string
  ) =>
    request<{ files: SkillFileInfo[]; inventory: SkillInventory }>(skillsUrl(taskId, '/file', sessionId, cwd), {
      method: 'DELETE',
      body: JSON.stringify(payload)
    }),

  setSkillPolicy: (name: string, enabled: boolean | null) =>
    request<{ skillPolicy: Record<string, boolean>; pendingRestart: boolean }>('/api/skills/policy', {
      method: 'POST',
      body: JSON.stringify({ name, enabled })
    })
};
