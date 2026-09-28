import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PS_TIMEOUT_MS = 4_000;
const LSOF_TIMEOUT_MS = 4_000;
const TERM_GRACE_MS = 400;

export interface ProcessKillSpec {
  /** Distinctive shell commands from this task's execute tools. */
  commands: string[];
  /** Session working directories — a leftover shell in here belongs to this stop. */
  cwds: string[];
}

interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash', 'fish']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exeBase(command: string): string {
  const exe = command.trim().split(/\s+/)[0] || '';
  return path.basename(exe);
}

export function isShellCommand(command: string): boolean {
  return SHELL_NAMES.has(exeBase(command));
}

function normalize(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

/**
 * Strip the shell wrapper and trailing comment so `zsh -c 'sleep 30 # x'`
 * and the `sleep 30` it exec'd compare as the same command.
 */
export function commandCore(command: string): string {
  let value = normalize(command);
  value = value.replace(
    /^(?:\/(?:bin|usr\/bin|opt\/homebrew\/bin)\/)?(?:ba)?sh\s+-c\s+/,
    ''
  );
  value = value.replace(/^(?:\/(?:bin|usr\/bin|opt\/homebrew\/bin)\/)?zsh\s+-c\s+/, '');
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  return normalize(value);
}

/**
 * True when `ps` command line is the agent's bash invocation (or the binary
 * that invocation exec'd). Short commands only count with a cwd match so `ls`
 * cannot harvest a random process. Only called on descendants of the agent.
 */
export function commandMatches(psCommand: string, toolCommand: string, cwdMatched: boolean): boolean {
  const needle = commandCore(toolCommand);
  const hay = commandCore(psCommand);
  if (!needle || !hay) return false;
  if (needle.length < 4) return cwdMatched && (hay === needle || hay.includes(needle));
  if (hay.includes(needle) || needle.includes(hay)) {
    if (Math.min(hay.length, needle.length) < 6 && !cwdMatched) return false;
    return true;
  }
  return false;
}

function cwdBelongs(cwd: string, roots: string[]): boolean {
  if (!cwd || roots.length === 0) return false;
  let resolved: string;
  try {
    resolved = path.resolve(cwd);
  } catch {
    return false;
  }
  for (const root of roots) {
    if (!root) continue;
    const base = path.resolve(root);
    if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) return true;
  }
  return false;
}

export async function listProcesses(): Promise<Proc[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], {
    timeout: PS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  });
  const rows: Proc[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const command = match[4]?.trim();
    if (!command) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command
    });
  }
  return rows;
}

function descendantPids(root: number, rows: Proc[]): Set<number> {
  const byParent = new Map<number, number[]>();
  for (const row of rows) {
    const list = byParent.get(row.ppid);
    if (list) list.push(row.pid);
    else byParent.set(row.ppid, [row.pid]);
  }
  const out = new Set<number>();
  const stack = [root];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    for (const child of byParent.get(pid) || []) {
      if (out.has(child) || child === root) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

async function processCwds(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;

  if (process.platform === 'linux') {
    for (const pid of pids) {
      try {
        map.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        // process exited, or we cannot read it
      }
    }
    return map;
  }

  const chunkSize = 40;
  for (let i = 0; i < pids.length; i += chunkSize) {
    const chunk = pids.slice(i, i + chunkSize);
    try {
      const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', chunk.join(',')], {
        timeout: LSOF_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024
      });
      let pid: number | undefined;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) {
          const parsed = Number(line.slice(1));
          pid = Number.isFinite(parsed) ? parsed : undefined;
        } else if (line.startsWith('n') && pid !== undefined) {
          map.set(pid, line.slice(1));
        }
      }
    } catch {
      // lsof is best-effort: command matching still runs without it.
    }
  }
  return map;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone, or not ours
  }
}

function signalGroup(pgid: number, sig: NodeJS.Signals): void {
  if (pgid <= 1) return;
  try {
    process.kill(-pgid, sig);
  } catch {
    // group already gone, or we are not allowed to signal it
  }
}

/**
 * `session/cancel` aborts the LLM turn. OpenCode's bash tool often keeps the
 * OS process (especially once it has been backgrounded), so Stop has to walk
 * the agent process tree and kill what still belongs to this task.
 *
 * Only descendants of `ancestorPid` (the board's `opencode acp` child) are
 * considered, so a user's own terminal in the same folder is left alone.
 */
export async function killAgentProcesses(
  ancestorPid: number | undefined,
  spec: ProcessKillSpec
): Promise<number> {
  if (!ancestorPid || ancestorPid <= 0) return 0;
  if (process.platform === 'win32') return 0;

  let rows: Proc[];
  try {
    rows = await listProcesses();
  } catch (e) {
    console.warn('[ACP] Could not list processes to stop leftover shells:', e);
    return 0;
  }

  const ancestor = rows.find((row) => row.pid === ancestorPid);
  const descendants = descendantPids(ancestorPid, rows);
  if (descendants.size === 0) return 0;

  const commands = spec.commands.map(normalize).filter(Boolean);
  const roots = spec.cwds.map((cwd) => cwd.replace(/\/+$/, '')).filter(Boolean);
  const cwds = roots.length > 0 ? await processCwds([...descendants]) : new Map<number, string>();

  const matched = new Set<number>();
  const groups = new Set<number>();

  for (const row of rows) {
    if (!descendants.has(row.pid)) continue;
    const cwdHit = cwdBelongs(cwds.get(row.pid) || '', roots);
    const cmdHit = commands.some((command) => commandMatches(row.command, command, cwdHit));
    const shellHit = isShellCommand(row.command) && cwdHit;
    if (!cmdHit && !shellHit) continue;
    matched.add(row.pid);
    if (ancestor && row.pgid !== ancestor.pgid && row.pgid === row.pid) {
      groups.add(row.pgid);
    }
  }

  // A matched shell's children (the actual `npm test`, `sleep`, ...) must die
  // with it — SIGTERM on the wrapper is not enough once the child is detached.
  const targets = new Set<number>(matched);
  for (const pid of matched) {
    for (const child of descendantPids(pid, rows)) targets.add(child);
  }

  if (targets.size === 0) return 0;

  // Children first so a shell does not reap (and hide) its descendants.
  const ordered = [...targets].sort((a, b) => b - a);
  for (const pgid of groups) signalGroup(pgid, 'SIGTERM');
  for (const pid of ordered) signal(pid, 'SIGTERM');
  await sleep(TERM_GRACE_MS);
  for (const pgid of groups) {
    if (alive(pgid)) signalGroup(pgid, 'SIGKILL');
  }
  for (const pid of ordered) {
    if (alive(pid)) signal(pid, 'SIGKILL');
  }

  return ordered.filter((pid) => !alive(pid)).length || ordered.length;
}
