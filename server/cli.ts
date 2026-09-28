import fs from 'fs';
import path from 'path';
import { cliHelp, parseCliArgs } from '../shared/app/cliArgs.js';
import { PACKAGE_ROOT, PRODUCTION_PORT } from './app/appPaths.js';

/**
 * The entry point of the built app — what `agent-master-3000` and `npm start` run, and
 * what `scripts/build-server.mjs` bundles into `dist-server/cli.mjs`.
 *
 * Flags become the environment variables the server already reads, and only
 * then is the server loaded: modules such as the state file settle their paths
 * when they are first evaluated, so the import has to come after, and has to
 * be dynamic.
 */

function packageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const parsed = parseCliArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`agent-master-3000: ${parsed.error}\nRun 'agent-master-3000 --help' for usage.`);
  process.exit(2);
}
const { options } = parsed;

if (options.help) {
  console.log(cliHelp(packageVersion(), PRODUCTION_PORT));
  process.exit(0);
}
if (options.version) {
  console.log(packageVersion());
  process.exit(0);
}

if (options.port !== undefined) process.env.PORT = String(options.port);
if (options.host) process.env.HOST = options.host;
if (options.dataDir) process.env.AGENT_MASTER_DATA_DIR = path.resolve(options.dataDir);
if (options.config) process.env.AGENT_MASTER_CONFIG = path.resolve(options.config);

if (options.paths) {
  // Only the path code: loading the server would open the board.
  const [{ setupReport }, { formatSetupReport, setupSeverity }] = await Promise.all([
    import('./setup/locations.js'),
    import('../shared/setup/report.js')
  ]);
  const report = setupReport();
  console.log(formatSetupReport(report));
  process.exit(setupSeverity(report.locations) === 'error' ? 1 : 0);
}

await import('./index.js');
