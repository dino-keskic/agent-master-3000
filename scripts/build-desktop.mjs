/**
 * Bundles the desktop app's main process (`desktop/main.ts`) into
 * `dist-desktop/main.mjs`, the `main` electron-builder packages.
 *
 * Like `build-server.mjs`: `desktop/` and the `shared/` it uses are inlined,
 * and `electron` stays external — it is the runtime, not a dependency. The
 * bundle sits one directory below the package root so `desktop/boardProcess.ts`
 * finds `dist-server/` beside it, as it does in the packaged app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-desktop');

fs.rmSync(outdir, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: { main: 'desktop/main.ts' },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info'
});
