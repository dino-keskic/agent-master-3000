/** The manager: the one conversation about the whole board. */

import { BoardTask } from '../../shared/types';
import { post } from './http';

export const managerApi = {
  /** The manager task — made, and sent its briefing, the first time it is asked for. */
  openManager: () => post<BoardTask>('/api/manager')
};
