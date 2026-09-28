#!/usr/bin/env node
/**
 * The `agent-master-3000` command, as npm links it on install.
 *
 * Plain JavaScript with no imports of its own, so it can check the Node version
 * before loading the server: the server needs `node:sqlite` without a flag,
 * which is Node 22.13+ (or 23.4+), and an older Node would otherwise die with
 * an ERR_UNKNOWN_BUILTIN_MODULE that says nothing about why.
 */

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)) {
  console.error(`agent-master-3000 needs Node.js 22.13 or newer (for node:sqlite); this is ${process.version}.`);
  process.exit(1);
}

// A shell left in a folder that has since gone (an unplugged drive, a deleted
// checkout) has no working directory, and Express's dependencies read it while
// loading — the board died with a uv_cwd ENOENT before printing a word. The
// board keeps nothing relative to where it was started, so home will do.
try {
  process.cwd();
} catch {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) throw new Error('agent-master-3000: the current folder no longer exists; cd somewhere and try again.');
  process.chdir(home);
}

// The bundle ships its source map; this makes a stack trace name server/*.ts lines.
process.setSourceMapsEnabled(true);

const cli = new URL('../dist-server/cli.mjs', import.meta.url);
try {
  await import(cli.href);
} catch (e) {
  // Run from a checkout that was never built: say so instead of a stack trace.
  if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes('dist-server')) {
    console.error('agent-master-3000: the server has not been built. Run `npm run build` first.');
    process.exit(1);
  }
  throw e;
}
