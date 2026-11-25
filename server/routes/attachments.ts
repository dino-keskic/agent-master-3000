import { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { xdgDirs } from '../../shared/setup/locations.js';
import { mediaMimeForPath } from '../../shared/transcript/media.js';
import { absoluteTarget, resolveWithinRoots } from '../app/openExternal.js';
import { readAttachmentPath, saveImage } from '../board/attachments.js';
import { boardRoots, transcriptsNamePath } from '../board/queries.js';
import { VideoSheetError, saveVideoSheet } from '../board/videoSheet.js';
import { route } from '../http/app.js';
import { opencodeGlobalConfigDirs } from '../setup/locations.js';
import { queryString } from './common.js';

function isWithinDir(target: string, dir: string): boolean {
  const resolved = path.resolve(target);
  const base = path.resolve(dir);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

/** OpenCode's own config/state/cache folders are never served through `/api/media`. */
function isForbiddenOpencodePath(target: string): boolean {
  const home = os.homedir();
  const xdg = xdgDirs(process.env, home);
  const forbidden = [
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.cache', 'opencode'),
    path.join(xdg.data, 'opencode'),
    path.join(xdg.config, 'opencode'),
    path.join(xdg.cache, 'opencode'),
    ...opencodeGlobalConfigDirs()
  ];
  return forbidden.some((dir) => isWithinDir(target, dir));
}

/**
 * The images and videos a prompt carries, plus local media cited in transcripts.
 *
 * Upload answers with the reference the composer then sends along with the
 * turn; `/api/attachments/:id` is what an `<img>` or `<video>` in the
 * transcript points at, served via `sendFile` so HTTP Range requests work for
 * video scrubbing. `/api/media` serves local images and videos referenced by
 * markdown inside board folders or transcripts, gated like `/api/open`.
 */
export function registerAttachmentRoutes(app: Express): void {
  app.post('/api/attachments', route(async (req: Request, res: Response) => {
    const { name, data, mimeType } = req.body as { name?: string; data?: string; mimeType?: string };
    if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'No image data' });

    try {
      res.status(201).json(saveImage({ name, data, mimeType }));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not store that image' });
    }
  }));

  // Not JSON, so `express.json` leaves the stream alone. The filename is in the
  // query string because the body is nothing but the video.
  app.post('/api/attachments/video', route(async (req: Request, res: Response) => {
    const name = typeof req.query.name === 'string' ? req.query.name : 'video';
    try {
      res.status(201).json(await saveVideoSheet(req, name));
    } catch (e) {
      if (!(e instanceof VideoSheetError)) throw e;
      // An over-cap upload is still arriving; without this the browser sees a
      // reset connection instead of the reason.
      if (e.status === 413) res.setHeader('Connection', 'close');
      res.status(e.status).json({ error: e.message });
    }
  }));

  app.get('/api/attachments/:id', (req: Request<{ id: string }>, res: Response) => {
    const attachment = readAttachmentPath(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'No such image' });

    // The id is a fresh uuid per upload, so the bytes behind it never change.
    // sendFile handles HTTP Range / 206 Partial Content natively for <video>.
    res.sendFile(attachment.file, {
      dotfiles: 'allow',
      headers: {
        'Content-Type': attachment.mimeType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  });

  app.get('/api/media', (req: Request, res: Response) => {
    const target = queryString(req, 'path');
    const taskId = queryString(req, 'taskId') || undefined;
    const mimeType = mediaMimeForPath(target);
    if (!target || !mimeType) {
      return res.status(400).json({ error: 'Path must point to a supported image or video file' });
    }

    const named = absoluteTarget(target);
    const resolved =
      resolveWithinRoots(target, boardRoots()) ||
      (named && transcriptsNamePath(named, taskId) ? named : undefined);

    if (!resolved || isForbiddenOpencodePath(resolved)) {
      return res.status(403).json({
        error: 'That path is outside every folder on the board, and no transcript mentions it'
      });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return res.status(404).json({ error: 'Media file not found' });
    }
    if (!stat.isFile()) return res.status(400).json({ error: 'Path is not a file' });

    try {
      if (isForbiddenOpencodePath(fs.realpathSync(resolved))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch {
      return res.status(404).json({ error: 'Media file not found' });
    }

    res.sendFile(resolved, {
      dotfiles: 'allow',
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  });
}
