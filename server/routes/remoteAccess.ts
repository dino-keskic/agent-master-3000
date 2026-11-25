import { Express } from 'express';
import { route } from '../http/app.js';
import { RouteContext } from './context.js';

/**
 * Inspect and toggle the optional remote-access listener, Tailscale HTTPS
 * reverse proxy, and macOS idle-sleep prevention used for phone access.
 */
export function registerRemoteAccessRoutes(app: Express, ctx: RouteContext): void {
  app.get('/api/remote-access', route(async (_req, res) => {
    res.json(await ctx.remoteAccess.refreshStatus());
  }));

  app.post('/api/remote-access/enable', route(async (_req, res) => {
    res.json(await ctx.remoteAccess.enable());
  }));

  app.post('/api/remote-access/disable', route(async (_req, res) => {
    res.json(await ctx.remoteAccess.disableAsync());
  }));

  app.post('/api/remote-access/tailscale/https/enable', route(async (_req, res) => {
    res.json(await ctx.remoteAccess.enableTailscaleHttps());
  }));

  app.post('/api/remote-access/tailscale/https/disable', route(async (_req, res) => {
    res.json(await ctx.remoteAccess.disableTailscaleHttps());
  }));

  app.post('/api/remote-access/keep-awake', (req, res) => {
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '`enabled` must be a boolean' });
    }
    return res.json(ctx.remoteAccess.setKeepAwake(enabled));
  });
}
