import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { corsOrigin, requestGuard } from './requestGuard.js';

/** Params for the `:id` routes, so `req.params.id` is a string and not `string | undefined`. */
export type IdParams = { id: string };
export type SessionParams = { id: string; sessionId: string };
export type CommentParams = { id: string; commentId: string };
export type LinkParams = { id: string; linkId: string };

type RouteParams = Record<string, string>;

/**
 * Express 4 does not catch rejections from async handlers: the promise is
 * dropped, no response is ever sent, and the client hangs until it times out.
 * Wrapping forwards the rejection to the error middleware below.
 * (Express 5 does this natively — drop the wrapper when upgrading.)
 */
export const route =
  <P extends RouteParams = RouteParams>(handler: (req: Request<P>, res: Response) => Promise<unknown>) =>
  (req: Request<P>, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

/**
 * The app with its middleware, before any route is mounted.
 *
 * The guard runs first: a request from another site, or under a hostname the
 * board does not answer to (DNS rebinding), never reaches a route.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestGuard);
  app.use(cors({ origin: corsOrigin }));
  app.use((_req, res, next) => {
    // Attachments are served as the bytes that were uploaded: never let a
    // browser sniff them into something else, or another site embed them.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });
  // A dropped screenshot arrives as base64 in a JSON body; express's 100kb
  // default rejects every one of them.
  app.use(express.json({ limit: '25mb' }));
  return app;
}

/** Mounted after every route, so a throw anywhere becomes a JSON response. */
export function useErrorHandler(app: express.Express): void {
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const isCorsRejection = err?.message?.startsWith('Blocked by CORS');
    res.status(isCorsRejection ? 403 : 500).json({ error: err?.message || 'Internal server error' });
  });
}
