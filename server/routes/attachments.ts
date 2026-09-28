import { Express, Request, Response } from 'express';
import { readImage, saveImage } from '../board/attachments.js';
import { route } from '../http/app.js';

/**
 * The images a prompt carries: dropped in here, read back out here.
 *
 * Upload answers with the reference the composer then sends along with the
 * turn; the GET is what an `<img>` in the transcript points at. Nothing here
 * touches a task — an image exists before anyone has decided which turn it
 * belongs to, and a turn that is never sent just leaves an unreferenced file.
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

  app.get('/api/attachments/:id', (req: Request<{ id: string }>, res: Response) => {
    const file = readImage(req.params.id);
    if (!file) return res.status(404).json({ error: 'No such image' });

    // The id is a fresh uuid per upload, so the bytes behind it never change.
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(file.bytes);
  });
}
