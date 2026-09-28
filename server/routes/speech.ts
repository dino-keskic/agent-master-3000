import express, { Express, Request, Response } from 'express';
import { MAX_DICTATION_SECONDS, SPEECH_SAMPLE_RATE } from '../../shared/composer/dictation.js';
import { route } from '../http/app.js';
import { speech } from '../speech/index.js';

/**
 * Dictation: is the local model there, load it now, and turn this clip into text.
 *
 * The clip arrives as the raw WAV body rather than base64 in JSON — it is
 * already the exact bytes the model server reads, and a third bigger for nothing
 * would be the only thing encoding it bought.
 */

/** 16-bit mono at 16 kHz, plus some slack for the header and a long pause. */
const MAX_BYTES = Math.ceil(MAX_DICTATION_SECONDS * SPEECH_SAMPLE_RATE * 2 * 1.1);

export function registerSpeechRoutes(app: Express): void {
  app.get('/api/speech', (_req: Request, res: Response) => {
    res.json(speech.getStatus());
  });

  app.post('/api/speech/warm', (_req: Request, res: Response) => {
    res.status(202).json(speech.warm());
  });

  app.post(
    '/api/speech/transcribe',
    express.raw({ type: ['audio/wav', 'audio/x-wav'], limit: MAX_BYTES }),
    route(async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body) || req.body.length <= 44) {
        return res.status(400).json({ error: 'No audio received' });
      }
      try {
        res.json({ text: await speech.transcribe(req.body) });
      } catch (e) {
        res.status(503).json({ error: e instanceof Error ? e.message : 'Speech model unavailable' });
      }
    })
  );
}
