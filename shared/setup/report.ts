/**
 * Where things are, as the setup screens show it: the board's data folder and
 * the pieces of OpenCode the board depends on, what was found at each, and
 * what a path the user typed in means.
 *
 * Nothing here touches the disk. The server looks (`server/setup/locations.ts`) and
 * hands over `PathFacts`; this module says what those facts mean, so the
 * onboarding step, the settings panel and `agent-master-3000 --paths` all give the
 * same verdict in the same words. Path arithmetic lives in `locations.ts`,
 * which the client never loads.
 */

export type LocationKey = 'dataDir' | 'opencodeBin' | 'opencodeConfigDir' | 'opencodeDb' | 'opencodeModels';

/** In the order the setup screens list them. */
export const LOCATION_KEYS: readonly LocationKey[] = [
  'dataDir',
  'opencodeBin',
  'opencodeConfigDir',
  'opencodeDb',
  'opencodeModels'
];

/**
 * Who decided a location. `env` beats everything and cannot be changed from the
 * board, `config` is the setup file, `detected` is a search that found it, and
 * `default` is where it is supposed to be.
 */
export type LocationSource = 'env' | 'config' | 'detected' | 'default';

export interface LocationInfo {
  title: string;
  hint: string;
  kind: 'file' | 'dir';
  /** What has to restart before a change is felt. */
  restart: 'board' | 'agent';
}

export const LOCATION_INFO: Record<LocationKey, LocationInfo> = {
  dataDir: {
    title: 'Board data',
    hint: 'Where this board keeps its tasks, transcripts and pasted images.',
    kind: 'dir',
    restart: 'board'
  },
  opencodeBin: {
    title: 'OpenCode program',
    hint: 'The opencode executable the board runs tasks with.',
    kind: 'file',
    restart: 'agent'
  },
  opencodeConfigDir: {
    title: 'OpenCode config folder',
    hint: 'Your opencode.json, agents, commands and skills.',
    kind: 'dir',
    restart: 'agent'
  },
  opencodeDb: {
    title: 'OpenCode sessions',
    hint: 'The database OpenCode writes every session to. The board reads history and costs from it.',
    kind: 'file',
    restart: 'agent'
  },
  opencodeModels: {
    title: 'OpenCode model list',
    hint: 'OpenCode’s cached model catalog: prices and context sizes.',
    kind: 'file',
    restart: 'agent'
  }
};

/** What the server found at a path. Absent fields were not looked at. */
export interface PathFacts {
  exists: boolean;
  kind?: 'file' | 'dir' | 'other';
  executable?: boolean;
  /** For a folder that does not exist: whether it could be created. */
  creatable?: boolean;
  writable?: boolean;
  /** An SQLite file with OpenCode's `session` table in it. */
  looksLikeDb?: boolean;
  /** A folder with a `board_state.json` in it. */
  hasBoard?: boolean;
}

export type Severity = 'ok' | 'warn' | 'error';

export interface Assessment {
  severity: Severity;
  note: string;
}

/** What `facts` about the path at `key` mean for the board. */
export function assessLocation(key: LocationKey, facts: PathFacts): Assessment {
  const { kind } = LOCATION_INFO[key];
  if (facts.exists && facts.kind !== kind) {
    return { severity: 'error', note: kind === 'dir' ? 'This is a file, not a folder.' : 'This is a folder, not a file.' };
  }

  switch (key) {
    case 'dataDir':
      if (!facts.exists) {
        return facts.creatable === false
          ? { severity: 'error', note: 'Cannot be created — the folder above it is missing or read-only.' }
          : { severity: 'ok', note: 'Will be created, with an empty board.' };
      }
      if (facts.writable === false) return { severity: 'error', note: 'The board cannot write here.' };
      return facts.hasBoard
        ? { severity: 'ok', note: 'A board is here.' }
        : { severity: 'ok', note: 'No board here yet — it starts empty.' };

    case 'opencodeBin':
      if (!facts.exists) {
        return { severity: 'error', note: 'OpenCode is not here, so tasks cannot run. Install it, or point to where it is.' };
      }
      return facts.executable === false
        ? { severity: 'error', note: 'This file is not executable.' }
        : { severity: 'ok', note: 'Found.' };

    case 'opencodeConfigDir':
      return facts.exists
        ? { severity: 'ok', note: 'Found.' }
        : { severity: 'warn', note: 'Not found. OpenCode creates it the first time it runs, or keeps its config somewhere else.' };

    case 'opencodeDb':
      if (!facts.exists) {
        return { severity: 'warn', note: 'Not found. Session history and costs stay empty until OpenCode has run once.' };
      }
      return facts.looksLikeDb === false
        ? { severity: 'error', note: 'This is not an OpenCode sessions database.' }
        : { severity: 'ok', note: 'Found.' };

    case 'opencodeModels':
      return facts.exists
        ? { severity: 'ok', note: 'Found.' }
        : { severity: 'warn', note: 'Not found. Costs and context sizes show as unknown until OpenCode downloads its model list.' };
  }
}

export interface LocationStatus extends Assessment {
  key: LocationKey;
  value: string;
  source: LocationSource;
  /** The environment variable that decided it, when one did. It cannot be changed from the board then. */
  envVar?: string;
  /** For the data folder: a board is already there. */
  hasBoard?: boolean;
}

/** Everything the setup screens show. */
export interface SetupReport {
  /** The setup file the board reads these from, and writes them to. */
  configFile: string;
  locations: LocationStatus[];
  /** Extra environment every OpenCode the board starts gets. */
  opencodeEnv: Record<string, string>;
  /** Other OpenCode executables that were found, for a one-click switch. */
  binCandidates: string[];
  /** The data folder this running board reads and writes. */
  dataDirInUse: string;
  /** Waiting for a restart: the board will be copied from `from` into the new data folder. */
  pendingMove?: { from: string; to: string };
  /** `BOARD_STATE_FILE` is set, so the data folder does not decide where the board is. */
  stateFileOverride?: string;
}

/** The worst thing on the report — what the header's settings button shows. */
export function setupSeverity(locations: readonly Pick<LocationStatus, 'severity'>[]): Severity {
  if (locations.some((l) => l.severity === 'error')) return 'error';
  if (locations.some((l) => l.severity === 'warn')) return 'warn';
  return 'ok';
}

/** The data folder moves on the next start, and this running board is not using it yet. */
export function needsBoardRestart(report: Pick<SetupReport, 'locations' | 'dataDirInUse'>): boolean {
  const data = report.locations.find((l) => l.key === 'dataDir');
  return !!data && data.value !== report.dataDirInUse;
}

export type DataMove = 'move' | 'fresh';

export interface SetupPatch {
  /** A path, or null to go back to the default. */
  locations?: Partial<Record<LocationKey, string | null>>;
  opencodeEnv?: Record<string, string>;
  /** Required when the data folder changes to one without a board: bring this board along, or start empty. */
  dataMove?: DataMove;
}

export interface SetupSaveResult {
  report: SetupReport;
  /** `busy`: OpenCode has to restart to pick the change up, and turns are running. */
  agent: 'restarted' | 'busy' | 'unchanged';
}

/** One path, checked before it is saved. */
export interface LocationCheck extends Assessment {
  value: string;
  hasBoard?: boolean;
}

/**
 * A typed path, cleaned up: surrounding quotes and whitespace gone, `~`
 * expanded, trailing slashes dropped. Null when it is not a full path — the
 * board runs from wherever it was started, so a relative one would mean
 * something different on every start.
 */
export function normalizePathInput(raw: string, home: string): string | null {
  let value = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (value === '~') value = home;
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = home.replace(/[\\/]+$/, '') + value.slice(1);
  const absolute = value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
  if (!absolute) return null;
  return value.length > 1 ? value.replace(/(?<=[^:])[\\/]+$/, '') : value;
}

/**
 * Environment variables the board sets on OpenCode from the locations above.
 * Setting one of these in the extra environment would quietly disagree with
 * the location the screen shows, so it is refused with a pointer instead.
 */
export const LOCATION_ENV_VARS: Record<string, LocationKey> = {
  OPENCODE_BIN: 'opencodeBin',
  OPENCODE_CONFIG_DIR: 'opencodeConfigDir',
  OPENCODE_DB: 'opencodeDb',
  OPENCODE_MODELS_PATH: 'opencodeModels',
  OPENCODE_MODELS: 'opencodeModels',
  AGENT_MASTER_DATA_DIR: 'dataDir'
};

/** Never handed to OpenCode: the board's own secret, and the one the board builds itself. */
const FORBIDDEN_ENV = new Set(['BOARD_TOKEN', 'OPENCODE_CONFIG_CONTENT']);

export interface EnvParse {
  env: Record<string, string>;
  errors: string[];
}

/** `KEY=value` lines, as the settings panel edits them. Blank lines and `#` comments are skipped. */
export function parseEnvLines(text: string): EnvParse {
  const env: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const body = trimmed.replace(/^export\s+/, '');
    const eq = body.indexOf('=');
    const key = eq > 0 ? body.slice(0, eq).trim() : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`Line ${index + 1}: expected NAME=value`);
      return;
    }
    const problem = envKeyProblem(key);
    if (problem) {
      errors.push(`Line ${index + 1}: ${problem}`);
      return;
    }
    env[key] = body.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  });
  return { env, errors };
}

/** Why `key` cannot be set in the extra environment, if it cannot. */
export function envKeyProblem(key: string): string | undefined {
  const location = LOCATION_ENV_VARS[key];
  if (location) return `${key} is set by “${LOCATION_INFO[location].title}” above`;
  if (FORBIDDEN_ENV.has(key)) return `${key} is managed by the board`;
  return undefined;
}

export function formatEnvLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

const SOURCE_LABEL: Record<LocationSource, string> = {
  env: 'from the environment',
  config: 'set in the setup file',
  detected: 'found',
  default: 'default'
};

/** How a location's source reads on screen and in `agent-master-3000 --paths`. */
export function sourceLabel(status: Pick<LocationStatus, 'source' | 'envVar'>): string {
  return status.source === 'env' && status.envVar ? `from $${status.envVar}` : SOURCE_LABEL[status.source];
}

const MARK: Record<Severity, string> = { ok: '✓', warn: '!', error: '✗' };

/** `agent-master-3000 --paths`: the settings panel's report, as text. */
export function formatSetupReport(report: SetupReport): string {
  const lines = [`Setup file: ${report.configFile || '(none)'}`, ''];
  for (const status of report.locations) {
    lines.push(`${MARK[status.severity]} ${LOCATION_INFO[status.key].title}: ${status.value}`);
    lines.push(`    ${sourceLabel(status)} — ${status.note}`);
  }
  const env = Object.keys(report.opencodeEnv);
  if (env.length > 0) lines.push('', `Extra OpenCode environment: ${env.join(', ')}`);
  if (report.pendingMove) lines.push('', `On the next start the board is copied from ${report.pendingMove.from}.`);
  if (report.stateFileOverride) lines.push('', `BOARD_STATE_FILE puts the board at ${report.stateFileOverride}.`);
  return lines.join('\n');
}
