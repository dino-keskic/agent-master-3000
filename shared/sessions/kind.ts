import { TaskLogItem, ToolCallInfo } from '../types';

/** Distinctive work. Routine git status/diff/log is ignored. */
export type WorkKind = 'edit' | 'read' | 'search' | 'test' | 'review' | 'device' | 'shell';

/** Session actually left a mark on git/GitHub — not "it ran git status". */
export type ShipEvent = 'committed' | 'pushed' | 'pr';

export interface SessionKind {
  kind: WorkKind;
  label: string;
  buckets: Record<WorkKind, number>;
  mix: string;
  shipped?: ShipEvent;
  shipLabel?: string;
}

const EMPTY_BUCKETS = (): Record<WorkKind, number> => ({
  edit: 0, read: 0, search: 0, test: 0, review: 0, device: 0, shell: 0
});

const LABELS: Record<WorkKind, string> = {
  edit: 'edits',
  read: 'reading',
  search: 'search',
  test: 'tests',
  review: 'review',
  device: 'device test',
  shell: 'shell'
};

const SHIP_LABEL: Record<ShipEvent, string> = {
  committed: 'committed',
  pushed: 'pushed',
  pr: 'PR opened'
};

const SHIP_RANK: Record<ShipEvent, number> = { committed: 1, pushed: 2, pr: 3 };

/** Second badge only if it's also distinctive work, not "it also grepped". */
const DISTINCTIVE = new Set<WorkKind>(['edit', 'test', 'review', 'device']);

const SKIP = /^(think|todowrite|todo|other)$/;
const NOISE_VERBS = new Set(['cd', 'echo', 'sleep', 'true', 'false', 'export', 'unset', 'wait', 'printf']);

function commandFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  for (const key of ['command', 'cmd', 'bash']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function stripNoise(segment: string): string {
  let s = segment.trim().replace(/^#\s*/, '');
  s = s.replace(/^rtk\s+/i, '');
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, '');
  }
  return s.trim();
}

export interface ShellClassification {
  work: WorkKind[];
  ship: ShipEvent[];
}

/**
 * True when a shell segment sends output into a file.
 *
 * This has to run before the noise-verb filter: `printf 'x' > config.json` and
 * `echo hi >> notes.md` create files, but their verbs are on the ignore list, so
 * without this check a session that wrote its work entirely through redirects
 * was classified as having done nothing at all.
 *
 * `2>&1` and `>&2` are stream duplication, not writes, and are excluded.
 */
export function writesViaRedirect(segment: string): boolean {
  const withoutQuoted = segment.replace(/'[^']*'|"[^"]*"/g, ' ');
  if (/\btee\b/.test(withoutQuoted)) return true;
  // `>`/`>>`/`&>` pointing at a name rather than at another descriptor.
  return /(?:&>>?|>>?)\s*(?!&)\S/.test(withoutQuoted);
}

/**
 * Classify a shell snippet. `cd && rg` is search. `git status` is ignored.
 * `git commit` / `git push` / `gh pr create` are shipping events, not a "git" kind.
 */
export function inspectShellCommand(command: string): ShellClassification {
  const work: WorkKind[] = [];
  const ship: ShipEvent[] = [];
  const parts = command.split(/\s*(?:&&|\|\||;)+\s*/);

  for (const raw of parts) {
    const s = stripNoise(raw);
    if (!s) continue;
    const lower = s.toLowerCase();
    const verb = (lower.match(/^(\.?\/[^\s]+|[a-z0-9._-]+)/) || [])[1] || '';
    // A redirect makes even an "ignored" verb a write, so check it first.
    if (writesViaRedirect(s)) {
      work.push('edit');
      continue;
    }
    if (NOISE_VERBS.has(verb)) continue;

    if (/\bmarionette_|\bmaestro\b|\bxcrun\b|\bsimctl\b|\badb\b|\bflutter run\b/.test(lower)) {
      work.push('device');
      continue;
    }
    if (
      /\bflutter test\b|\bflutter analyze\b|\bpytest\b|\bcargo test\b|\bgo test\b|\bnpm test\b|\bpnpm test\b|\byarn test\b|\bvitest\b|\bjest\b|run_tests/.test(lower)
    ) {
      work.push('test');
      continue;
    }
    if (/\bgh\s+pr\s+create\b/.test(lower)) {
      ship.push('pr');
      continue;
    }
    if (/\bgh\s+pr\b/.test(lower) || /\bgh\s+api\b/.test(lower) && /\/pulls\b/.test(lower)) {
      work.push('review');
      continue;
    }
    if (verb === 'git' || /^git\s/.test(lower)) {
      if (/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(lower)) ship.push('committed');
      else if (/\bgit\s+(?:-C\s+\S+\s+)?push\b/.test(lower)) ship.push('pushed');
      continue;
    }
    if (/\bacli\s+pr\b/.test(lower) || /\bhub\s+pr\b/.test(lower)) {
      work.push('review');
      continue;
    }
    if (/\b(rg|grep|ag|ack|ripgrep)\b/.test(lower) || verb === 'fd' || verb === 'find') {
      work.push('search');
      continue;
    }
    if (/\bsed\s+-[^\s]*i/.test(lower) || /\bperl\s+-pi\b/.test(lower) || /\bcat\s+>/.test(lower) || /\btee\b/.test(lower)) {
      work.push('edit');
      continue;
    }
    if (verb === 'read' || /\b(cat|head|tail|less|bat|ls|tree|wc|awk|sed)\b/.test(lower)) {
      work.push('read');
      continue;
    }
    work.push('shell');
  }
  return { work, ship };
}

/** @deprecated use inspectShellCommand — kept for call sites that only care about work. */
export function classifyShellCommand(command: string): WorkKind[] {
  return inspectShellCommand(command).work;
}

export function classifyTool(info: Pick<ToolCallInfo, 'name' | 'kind' | 'rawInput'>): ShellClassification {
  const name = (info.name || '').toLowerCase();
  const kind = (info.kind || '').toLowerCase();
  const empty: ShellClassification = { work: [], ship: [] };

  if (name.startsWith('marionette') || name.includes('maestro')) return { work: ['device'], ship: [] };
  if (name.startsWith('get-pr') || name.startsWith('wait-for-pr')) {
    return { work: ['review'], ship: [] };
  }
  if (name.startsWith('jira')) return empty;
  if (kind === 'edit' || name === 'edit' || name === 'write' || name === 'patch') return { work: ['edit'], ship: [] };
  if (kind === 'read' || name === 'read') return { work: ['read'], ship: [] };
  if (kind === 'search' || name === 'search' || name === 'glob' || name === 'grep') return { work: ['search'], ship: [] };
  if (kind === 'execute' || name === 'execute' || name === 'bash' || name === 'shell') {
    const command = commandFromInput(info.rawInput);
    if (command) return inspectShellCommand(command);
    return { work: ['shell'], ship: [] };
  }
  if (SKIP.test(name) || SKIP.test(kind) || kind === 'think' || kind === 'other' || name === 'other') return empty;
  return empty;
}

function pickKind(buckets: Record<WorkKind, number>): WorkKind | undefined {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) return undefined;
  if (buckets.device >= 4) return 'device';
  if (buckets.edit >= 1) return 'edit';
  if (buckets.test >= 3) return 'test';
  if (buckets.review >= 3) return 'review';
  if (buckets.search + buckets.read >= 5) return 'read';
  if (buckets.shell >= 3) return 'shell';
  return (Object.entries(buckets) as [WorkKind, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

function mixLine(kind: WorkKind, buckets: Record<WorkKind, number>): string {
  const rest = (Object.entries(buckets) as [WorkKind, number][])
    .filter(([k, n]) => n > 0 && k !== kind && DISTINCTIVE.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  return [[kind, buckets[kind]] as [WorkKind, number], ...rest]
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${LABELS[k]}`)
    .join(' · ');
}

function strongestShip(events: ShipEvent[]): ShipEvent | undefined {
  let best: ShipEvent | undefined;
  for (const event of events) {
    if (!best || SHIP_RANK[event] > SHIP_RANK[best]) best = event;
  }
  return best;
}

export function classifySessionLogs(logs: TaskLogItem[] | undefined): SessionKind | undefined {
  if (!logs || logs.length === 0) return undefined;
  const buckets = EMPTY_BUCKETS();
  const ships: ShipEvent[] = [];
  for (const log of logs) {
    if (log.type !== 'tool_call' || !log.toolCall) continue;
    const { work, ship } = classifyTool(log.toolCall);
    for (const kind of work) buckets[kind] += 1;
    ships.push(...ship);
  }
  const kind = pickKind(buckets);
  const shipped = strongestShip(ships);
  if (!kind && !shipped) return undefined;

  const resolvedKind = kind || 'shell';
  const second = (Object.entries(buckets) as [WorkKind, number][])
    .filter(([k, n]) => k !== resolvedKind && DISTINCTIVE.has(k) && n >= 3)
    .sort((a, b) => b[1] - a[1])[0];
  let label = LABELS[resolvedKind];
  if (kind && second && second[1] >= Math.max(3, buckets[resolvedKind] * 0.25)) {
    label = `${LABELS[kind]} · ${LABELS[second[0]]}`;
  }

  return {
    kind: resolvedKind,
    label: kind ? label : '',
    buckets,
    mix: kind ? mixLine(kind, buckets) : '',
    shipped,
    shipLabel: shipped ? SHIP_LABEL[shipped] : undefined
  };
}
