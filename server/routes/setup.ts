import { execFile } from 'child_process';
import { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { errorField, errorMessage } from '../../shared/errors.js';
import { LOCATION_KEYS, LocationKey, SetupPatch, SetupSaveResult } from '../../shared/setup/report.js';
import { acpManager } from '../acp/client.js';
import { route } from '../http/app.js';
import { setupReport } from '../setup/configLayers.js';
import { checkLocation, saveSetup } from '../setup/locations.js';
import { clearToolCatalogCache } from '../toolCatalog/index.js';
import { RouteContext } from './context.js';

const execFileAsync = promisify(execFile);

/**
 * Where things are: the onboarding step's and the settings panel's server
 * side. Reading the report, checking a typed path, saving a change — and
 * restarting the agent when the change is one it has to be started with.
 */

function isLocationKey(value: unknown): value is LocationKey {
  return typeof value === 'string' && (LOCATION_KEYS as readonly string[]).includes(value);
}

/** The AppleScript behind the native file or folder picker. */
function choosePathScript(kind: 'file' | 'folder', startPath: string): string {
  const verb = kind === 'file' ? 'choose file with prompt "Select a file"' : 'choose folder with prompt "Select a folder"';
  return [
    `set startLocation to POSIX file ${JSON.stringify(startPath)}`,
    'tell application "System Events"',
    '  activate',
    `  set chosen to ${verb} default location startLocation with invisibles`,
    'end tell',
    'return POSIX path of chosen'
  ].join('\n');
}

/** The nearest folder that exists at or above `requested`, so the picker opens where the path points. */
function startFolder(requested: string): string {
  let at = requested && path.isAbsolute(requested) ? requested : os.homedir();
  while (!fs.existsSync(at) || !fs.statSync(at).isDirectory()) {
    const up = path.dirname(at);
    if (up === at) return os.homedir();
    at = up;
  }
  return at;
}

export function registerSetupRoutes(app: Express, { orchestrator }: RouteContext): void {
  app.get('/api/setup', (_req: Request, res: Response) => {
    res.json(setupReport());
  });

  app.post('/api/setup/check', (req: Request, res: Response) => {
    const { key, value } = req.body || {};
    if (!isLocationKey(key) || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value are required' });
    }
    res.json(checkLocation(key, value));
  });

  /**
   * Save the setup. A change the agent is started with (the program, a
   * folder handed to it, the extra environment) restarts it straight away when
   * nothing is running; otherwise the answer says so and the panel offers the
   * restart itself.
   */
  app.put('/api/setup', (req: Request, res: Response) => {
    // Unchecked until each field has been looked at.
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: SetupPatch = {};
    if (body.locations && typeof body.locations === 'object') {
      patch.locations = {};
      for (const [key, value] of Object.entries(body.locations as Record<string, unknown>)) {
        if (!isLocationKey(key)) return res.status(400).json({ error: `Unknown location ${key}` });
        if (value !== null && typeof value !== 'string') return res.status(400).json({ error: `${key} must be a path or null` });
        patch.locations[key] = value;
      }
    }
    if (body.opencodeEnv !== undefined) {
      if (!body.opencodeEnv || typeof body.opencodeEnv !== 'object' || Array.isArray(body.opencodeEnv)) {
        return res.status(400).json({ error: 'opencodeEnv must be an object' });
      }
      patch.opencodeEnv = body.opencodeEnv as Record<string, string>;
    }
    if (body.dataMove === 'move' || body.dataMove === 'fresh') patch.dataMove = body.dataMove;

    const outcome = saveSetup(patch);
    if (!outcome.ok) {
      return res.status(outcome.status).json({ error: outcome.error, needsDataMove: outcome.needsDataMove });
    }

    let agent: SetupSaveResult['agent'] = 'unchanged';
    if (outcome.agentChanged) {
      clearToolCatalogCache();
      const busy = orchestrator.busyTasks().length > 0;
      if (busy) {
        agent = 'busy';
      } else {
        void acpManager.restartAgent();
        agent = 'restarted';
      }
    }
    const result: SetupSaveResult = { report: setupReport(), agent };
    res.json(result);
  });

  app.post('/api/setup/pick', route(async (req: Request, res: Response) => {
    if (process.platform !== 'darwin') {
      return res.status(501).json({ error: 'The native picker requires macOS' });
    }
    const kind = req.body?.kind === 'file' ? 'file' : 'folder';
    const startPath = startFolder(typeof req.body?.startPath === 'string' ? req.body.startPath : '');
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', choosePathScript(kind, startPath)]);
      const trimmed = stdout.trim();
      const picked = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
      if (!picked) return res.json({ cancelled: true });
      res.json({ path: picked, name: path.basename(picked) || picked });
    } catch (e) {
      const detail = errorField(e, 'stderr') || errorMessage(e) || '';
      if (detail.includes('-128') || /user canceled/i.test(detail)) return res.json({ cancelled: true });
      console.error('[setup] Picker failed:', detail.trim());
      res.status(500).json({ error: detail.trim() || 'Failed to open the picker' });
    }
  }));
}
