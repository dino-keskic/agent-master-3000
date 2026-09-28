import fs from 'fs';
import path from 'path';
import { BOARD_DATA_ENTRIES, dataMovePlan } from '../../shared/setup/locations.js';
import { boardConfigPath, dataDir } from '../app/appPaths.js';
import { readBoardConfig, writeBoardConfig } from './configFile.js';

/**
 * Bringing the board along when its data folder moves.
 *
 * The settings panel only records the wish (`moveDataFrom` in the setup file);
 * the copy happens here, on the next start, before the state file or the
 * attachments folder are opened — which is why `server/index.ts` imports this
 * module first. The old folder is left as it was: this copies, never moves, so
 * a mistake costs a folder to delete rather than a board.
 */

export function applyPendingDataMove(): void {
  const file = boardConfigPath();
  if (!file) return;
  const config = readBoardConfig(file);
  const from = config.moveDataFrom;
  if (!from) return;

  const to = dataDir();
  const done = () => {
    const { moveDataFrom: _dropped, ...rest } = readBoardConfig(file);
    writeBoardConfig(file, rest);
  };
  // BOARD_STATE_FILE puts the board somewhere else entirely; nothing to carry.
  if (process.env.BOARD_STATE_FILE || path.resolve(from) === path.resolve(to)) return done();

  let present: string[] = [];
  try {
    present = fs.readdirSync(from).filter((name) => (BOARD_DATA_ENTRIES as readonly string[]).includes(name));
  } catch {
    console.warn(`[setup] The old data folder ${from} is gone; starting with the board in ${to}.`);
    return done();
  }
  const plan = dataMovePlan(present, fs.existsSync(path.join(to, 'board_state.json')));
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of plan) {
      fs.cpSync(path.join(from, entry), path.join(to, entry), { recursive: true, force: false, errorOnExist: false });
    }
  } catch (e) {
    // Left pending: the next start tries again, and skips what already arrived.
    console.error(`[setup] Could not copy the board from ${from} to ${to}:`, (e as Error).message);
    return;
  }
  if (plan.length > 0) console.log(`[setup] Copied the board from ${from} to ${to}. The old copy is still there.`);
  done();
}

applyPendingDataMove();
