import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import {
  PROBE_OUT_ENV,
  PROBE_PLUGIN_PACKAGE,
  PROBE_PLUGIN_SOURCE,
  ProbedTool,
  parseProbeOutput
} from '../../shared/toolCatalog/toolSources.js';
import { dataDir } from '../app/appPaths.js';

/**
 * The board's tool probe on disk, for the short-lived OpenCode 2 server the
 * Tools panel reads from (`shared/toolCatalog/toolSources.ts` says why).
 *
 * It reaches that server alone: the server gets a config naming only the
 * probe, under `OPENCODE_CONFIG` where the agent has the board's policy file —
 * none of the board's switches, so every plugin loads and every tool is listed. Each read gets its own
 * copy and output file, so two folders read at once do not mix.
 *
 * What belongs here: writing the plugin, the copy and reading what it wrote.
 */

const PROBE_WAIT_MS = 6_000;
const PROBE_POLL_MS = 100;
/** One more of the probe's quarter-second writes, so MCP servers that just connected are in it. */
const PROBE_SETTLE_MS = 350;

export interface ToolProbe {
  /** The policy file copy, for `OPENCODE_CONFIG` and for telling the board's document apart. */
  configFile: string;
  env: Record<string, string>;
  read(): Promise<ProbedTool[] | null>;
  dispose(): void;
}

function writeIfChanged(file: string, body: string): void {
  try {
    if (fs.readFileSync(file, 'utf8') === body) return;
  } catch {
    // Not there yet.
  }
  fs.writeFileSync(file, body);
}

/** The probe, written under the board's data folder; undefined when it cannot be. */
export function prepareToolProbe(): ToolProbe | undefined {
  try {
    const root = path.join(dataDir(), 'tool-probe');
    const pluginDir = path.join(root, 'plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    writeIfChanged(path.join(pluginDir, 'package.json'), PROBE_PLUGIN_PACKAGE);
    writeIfChanged(path.join(pluginDir, 'index.mjs'), PROBE_PLUGIN_SOURCE);

    const id = randomBytes(6).toString('hex');
    const configFile = path.join(root, `config-${id}.opencode.json`);
    const outFile = path.join(os.tmpdir(), `agent-master-tool-probe-${id}.json`);
    fs.writeFileSync(configFile, `${JSON.stringify({ plugins: [pluginDir] }, null, 2)}\n`);

    return {
      configFile,
      env: { [PROBE_OUT_ENV]: outFile },
      read: () => readProbe(outFile),
      dispose: () => {
        for (const file of [configFile, outFile]) fs.rmSync(file, { force: true });
      }
    };
  } catch (e) {
    console.warn('[tools] Could not write the tool probe; the panel falls back to a fixed list:', e);
    return undefined;
  }
}

async function readProbe(outFile: string): Promise<ProbedTool[] | null> {
  const deadline = Date.now() + PROBE_WAIT_MS;
  const once = () => {
    try {
      return parseProbeOutput(fs.readFileSync(outFile, 'utf8'));
    } catch {
      return null;
    }
  };
  while (once() === null) {
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, PROBE_POLL_MS));
  }
  await new Promise((resolve) => setTimeout(resolve, PROBE_SETTLE_MS));
  return once();
}
