import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { SpeechStatus, cleanTranscript, pickModelFile, pickVadFile } from '../../shared/composer/dictation.js';
import { Launch, LocalModelServer, findExecutable } from './modelServer.js';

/**
 * whisper.cpp's `whisper-server` with large-v3-turbo — the engine for machines
 * Parakeet cannot run on, or for `SPEECH_ENGINE=whisper`.
 *
 * Models live in `~/.cache/whisper-models` — the same folder whisper.cpp
 * tooling and the transcribe skill use, so a model already there is simply
 * picked up; with none, the quantised turbo is downloaded.
 *
 * Env: `WHISPER_SERVER_BIN`, `WHISPER_MODELS_DIR`, `WHISPER_MODEL` (a file
 * name or path), `WHISPER_LANGUAGE` (default `auto`).
 */

const MODELS_DIR = process.env.WHISPER_MODELS_DIR || path.join(os.homedir(), '.cache', 'whisper-models');
const LANGUAGE = process.env.WHISPER_LANGUAGE || 'auto';

/** First launch compiles the Metal shaders (~25 s on an M2) before the model even loads. */
const START_TIMEOUT_MS = 180_000;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/** Fetched when the folder has no model at all: turbo at q5_0 is 574 MB and loses little. */
const DEFAULT_MODEL = {
  name: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
};
const DEFAULT_VAD = {
  name: 'ggml-silero-v5.1.2.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin'
};

function listModels(): string[] {
  try {
    return fs.readdirSync(MODELS_DIR);
  } catch {
    return [];
  }
}

function configuredModel(): string | undefined {
  const named = process.env.WHISPER_MODEL;
  if (!named) return undefined;
  return path.isAbsolute(named) ? named : path.join(MODELS_DIR, named);
}

async function download(url: string, name: string, onProgress: (fraction: number) => void): Promise<string> {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const target = path.join(MODELS_DIR, name);
  const partial = `${target}.part`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Downloading ${name} failed (${res.status})`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (total) onProgress(received / total);
      callback(null, chunk);
    }
  });
  // Written beside the target and renamed, so an interrupted download is never
  // mistaken for a model on the next start.
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), meter, fs.createWriteStream(partial));
  fs.renameSync(partial, target);
  return target;
}

export class WhisperServer extends LocalModelServer {
  constructor() {
    super('whisper-server');
  }

  protected check(): SpeechStatus {
    return findExecutable('whisper-server', process.env.WHISPER_SERVER_BIN)
      ? { state: 'idle', model: pickModelFile(listModels()) }
      : { state: 'unavailable', detail: 'whisper.cpp is not installed — run `brew install whisper-cpp`' };
  }

  protected async prepare(port: number): Promise<Launch> {
    const model = await this.resolveModel();
    const vad = await this.resolveVad();
    const args = [
      '-m', model,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-l', LANGUAGE,
      '-t', String(Math.min(8, Math.max(2, os.availableParallelism() - 2))),
      // Keeps `[BLANK_AUDIO]`-style tokens and sighs out of the text.
      '--suppress-nst'
    ];
    // Silero trims the silence before and after speech, which is exactly where
    // whisper invents its "Thank you." — and it makes long pauses cheap.
    if (vad) args.push('--vad', '-vm', vad);
    return {
      command: findExecutable('whisper-server', process.env.WHISPER_SERVER_BIN)!,
      args,
      model: path.basename(model),
      healthPath: '/',
      startTimeoutMs: START_TIMEOUT_MS
    };
  }

  protected async request(port: number, wav: Buffer): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'clip.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    form.append('temperature_inc', '0.2');
    if (LANGUAGE !== 'auto') form.append('language', LANGUAGE);

    const res = await fetch(`http://127.0.0.1:${port}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || body.error) throw new Error(body.error || `Speech model answered ${res.status}`);
    return cleanTranscript(body.text || '');
  }

  private async resolveModel(): Promise<string> {
    const configured = configuredModel();
    if (configured) {
      if (!fs.existsSync(configured)) throw new Error(`WHISPER_MODEL not found: ${configured}`);
      return configured;
    }
    const found = pickModelFile(listModels());
    if (found) return path.join(MODELS_DIR, found);

    this.status = { state: 'downloading', detail: DEFAULT_MODEL.name, progress: 0 };
    return download(DEFAULT_MODEL.url, DEFAULT_MODEL.name, (progress) => {
      this.status = { state: 'downloading', detail: DEFAULT_MODEL.name, progress };
    });
  }

  /** VAD is an improvement, not a requirement: a failed download just goes without. */
  private async resolveVad(): Promise<string | undefined> {
    const found = pickVadFile(listModels());
    if (found) return path.join(MODELS_DIR, found);
    try {
      return await download(DEFAULT_VAD.url, DEFAULT_VAD.name, () => undefined);
    } catch (e) {
      console.warn('[Speech] VAD model unavailable, continuing without it:', e);
      return undefined;
    }
  }
}
