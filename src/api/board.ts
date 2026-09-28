/** The board as a whole: its state, the options a turn can run with, and its settings. */

import { OpenCodeAgent, OpenCodeModel } from '../../shared/sessions/types';
import { SpendSummary } from '../../shared/spend/types';
import { BoardColumn, BoardState, GlobalSettings, ThinkingLevelOption } from '../../shared/types';
import { localeQuery, post, request } from './http';

export interface BoardResponse extends BoardState {
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  effortLevels: ThinkingLevelOption[];
  spend?: SpendSummary;
}

export interface ConfigOptionsResponse {
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  effortLevels: ThinkingLevelOption[];
}

export const boardApi = {
  getBoard: () => {
    const q = localeQuery();
    return request<BoardResponse>(q ? `/api/board?${q}` : '/api/board');
  },

  getConfigOptions: (model: string) =>
    request<ConfigOptionsResponse>(`/api/config-options?model=${encodeURIComponent(model)}`),

  updateSettings: (patchBody: Partial<GlobalSettings>) => post<GlobalSettings>('/api/settings', patchBody),

  updateColumns: (columns: BoardColumn[]) => post<GlobalSettings>('/api/settings', { columns })
};
