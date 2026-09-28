import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { normalizeHostname } from './shared/http/requestGuard';

function envPort(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Defaults are the user's running board. A scratch/debug instance must set
// VITE_DEV_PORT + API_PORT so it never binds 3999/3001.
const clientPort = envPort('VITE_DEV_PORT', 3999);
const apiPort = envPort('API_PORT', 3001);
// Loopback everywhere except the Docker sandbox, where the port has to be
// reachable from the host that published it.
const clientHost = process.env.VITE_DEV_HOST || '127.0.0.1';
// Vite answers localhost and IP addresses on its own; a name (a LAN hostname,
// a tunnel) has to be listed, the same list the API server checks.
const extraHosts = (process.env.BOARD_ALLOWED_HOSTS || '')
  .split(',')
  .map((entry) => normalizeHostname(entry))
  .filter((host): host is string => !!host);

export default defineConfig({
  plugins: [react()],
  server: {
    host: clientHost,
    port: clientPort,
    strictPort: true,
    allowedHosts: extraHosts,
    // Worktrees are cut inside the repo, so a checkout of this project sitting
    // in one is a second copy of every source file. Watching it reloads the dev
    // server on edits made in a different branch entirely.
    watch: { ignored: ['**/.worktrees/**'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true
      }
    }
  }
});
