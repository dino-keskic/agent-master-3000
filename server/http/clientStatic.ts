import fs from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';

/**
 * The built client, served by the API server itself — how the board runs as an
 * installed app, on one port. In dev Vite serves the client and proxies `/api`
 * and `/ws` here, so this is only mounted when running the bundle.
 *
 * Mounted after every route: `/api` and `/ws` belong to the server, so an
 * unknown `/api/...` is a JSON 404 and never the HTML page, and the `/ws`
 * upgrade is taken by the WebSocket server before Express sees it.
 */

/** Vite puts a content hash in every file name under `assets/`, so they never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Everything else — `index.html`, the service worker, the favicon — is revalidated. */
const REVALIDATE = 'no-cache';

/** Paths the SPA fallback must never answer, with or without a trailing segment. */
const SERVER_PREFIXES = ['/api', '/ws'];

function isServerPath(urlPath: string): boolean {
  return SERVER_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

/** Returns false (and mounts nothing) when there is no built client in `clientDir`. */
export function serveClient(app: express.Express, clientDir: string): boolean {
  const indexHtml = path.join(clientDir, 'index.html');
  if (!fs.existsSync(indexHtml)) return false;

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        const relative = path.relative(clientDir, filePath).split(path.sep).join('/');
        res.setHeader('Cache-Control', relative.startsWith('assets/') ? IMMUTABLE : REVALIDATE);
      }
    })
  );

  // Any other GET that wants a page gets the app, so a reload on a deep link
  // works. A missing `/assets/x.js` stays a 404: answering it with HTML would
  // turn a stale tab's failed chunk load into a confusing parse error.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isServerPath(req.path) || req.path.startsWith('/assets/')) return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', REVALIDATE);
    res.sendFile(indexHtml);
  });
  return true;
}
