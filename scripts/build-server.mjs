/**
 * Bundles the server so the built app runs on plain `node`, with no `tsx`.
 *
 * Two entries, both ESM, into `dist-server/`:
 *   - `cli.mjs`      — `server/cli.ts`, the whole server behind the command line
 *   - `boardMcp.mjs` — `server/mcp/boardMcp.ts`, the stdio MCP server OpenCode spawns
 *                      per session (see `boardMcpServer`)
 *
 * Everything under `server/` and `shared/` is inlined; packages stay external
 * and come from the installed `dependencies` (express, cors, ws, zod). Both
 * bundles sit one directory below the package root, like the `.ts` sources do,
 * so `server/app/appPaths.ts` resolves `dist/`, `package.json` and its siblings the
 * same way in both. Non-code files the server loads by `import.meta.url` are
 * copied alongside.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-server');

/** Loaded at runtime relative to the bundle, so they have to be next to it. */
const ASSETS = ['server/speech/parakeet_server.py'];

fs.rmSync(outdir, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: { cli: 'server/cli.ts', boardMcp: 'server/mcp/boardMcp.ts' },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  // node:sqlite is the floor anyway (22.13); this only stops esbuild lowering syntax.
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info'
});

for (const asset of ASSETS) {
  fs.copyFileSync(path.join(root, asset), path.join(outdir, path.basename(asset)));
}
