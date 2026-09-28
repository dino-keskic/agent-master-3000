import { Request, Response } from 'express';
import { BoardTask } from '../../shared/types.js';
import { BoardPublisher } from '../live/publisher.js';

/**
 * The caller's calendar, for anything that has to say "this week".
 *
 * A week boundary is local to the person reading it, and the server's timezone
 * is not theirs. The browser sends both explicitly; `Accept-Language` is the
 * fallback for a plain `curl`.
 */
export function requestCalendar(req: Request): { locale?: string; timeZone?: string } {
  const locale =
    (typeof req.query.locale === 'string' && req.query.locale.trim()) ||
    (typeof req.headers['accept-language'] === 'string'
      ? req.headers['accept-language'].split(',')[0]?.split(';')[0]?.trim()
      : undefined);
  const timeZone = typeof req.query.tz === 'string' && req.query.tz.trim() ? req.query.tz.trim() : undefined;
  return { locale: locale || undefined, timeZone };
}

/** A `?name=` value, or `''` — the shape every filter route wants. */
export function queryString(req: Request, name: string): string {
  const value = req.query[name];
  return typeof value === 'string' ? value : '';
}

/**
 * The reply shared by every write that edits a task in place: 404 when the
 * store refused, otherwise push the new state and hand it back.
 */
export function respondWithTask(
  publisher: BoardPublisher,
  res: Response,
  task: BoardTask | null,
  missing = 'Comment not found'
): void {
  if (!task) {
    res.status(404).json({ error: missing });
    return;
  }
  res.json(publisher.updated(task));
}
