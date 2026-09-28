import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { PathContext, boardConfigFile, resolveDataDir } from '../../shared/setup/locations.js';
import { readBoardConfig } from '../setup/configFile.js';

/**
 * Where the running board finds its own files, where it keeps the ones it
 * writes, and the address it listens on.
 *
 * The board runs two ways. From a checkout (`npm run dev`), `tsx` runs the
 * `.ts` sources, Vite serves the client, and what the board writes goes to
 * `./data` beside the code — as it always has. As the built app (`npm start`,
 * or `agent-master-3000` installed from a release tarball) it is the esbuild bundle in
 * `dist-server/`, started from wherever the user happened to be standing: the
 * client is the `dist/` built beside it, and the board's files go to the
 * per-user data directory rather than a `data/` under some random cwd —
 * or wherever the setup file (`server/setup/locations.ts`) moved it.
 *
 * Every server module is inlined into one bundle file, so `import.meta.url`
 * here is the bundle's URL when bundled and this file's URL when not. The
 * bundle sits one directory below the package root (`dist-server/`), this file
 * two (`server/app/`) — PACKAGE_ROOT depends on both, so move either with it.
 */

const HERE = fileURLToPath(import.meta.url);

/** True in the esbuild bundle, false under `tsx` (dev and the tests). */
export const IS_BUNDLED = !HERE.endsWith('.ts');

/** The repo in a checkout; the installed package's directory when bundled. */
export const PACKAGE_ROOT = path.resolve(path.dirname(HERE), IS_BUNDLED ? '..' : '../..');

/** The built client, as `vite build` writes it. */
export const CLIENT_DIR = path.join(PACKAGE_ROOT, 'dist');

/** The bundled server entries, as `scripts/build-server.mjs` writes them. */
export const SERVER_BUNDLE_DIR = path.join(PACKAGE_ROOT, 'dist-server');

export type { DataDirInput } from '../../shared/setup/locations.js';
export { resolveDataDir };

/** The facts every path default is worked out from, for this process. */
export function pathContext(env: NodeJS.ProcessEnv = process.env): PathContext {
  return { env, bundled: IS_BUNDLED, cwd: process.cwd(), home: os.homedir(), platform: process.platform };
}

/**
 * The board's setup file (`shared/setup/locations.ts` says where), or null under
 * `node --test` unless a test names one: a test must never pick up the
 * developer's own setup and read their real OpenCode through it.
 */
export function boardConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_TEST_CONTEXT && !env.AGENT_MASTER_CONFIG) return null;
  return boardConfigFile(pathContext(env));
}

/** The data directory for this process. Not created here — its writers do that. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = readBoardConfig(boardConfigPath(env)).dataDir;
  return resolveDataDir({ ...pathContext(env), configured });
}

/**
 * The built app's port when nothing says otherwise. Deliberately not the dev
 * stack's 3001/3999, so an installed board and a checkout can run side by side.
 */
export const PRODUCTION_PORT = 3737;

/** `PORT`/`HOST` if set; otherwise 3001 from a checkout (Vite proxies to it), PRODUCTION_PORT bundled. */
export function listenAddress(env: NodeJS.ProcessEnv = process.env, bundled = IS_BUNDLED): { port: number; host: string } {
  const fromEnv = Number(env.PORT);
  const port = env.PORT && Number.isInteger(fromEnv) && fromEnv >= 0 ? fromEnv : bundled ? PRODUCTION_PORT : 3001;
  return { port, host: env.HOST || '127.0.0.1' };
}
