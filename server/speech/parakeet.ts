import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { SpeechStatus, cleanTranscript, parakeetDownloadProgress } from '../../shared/composer/dictation.js';
import { Launch, LocalModelServer, findExecutable } from './modelServer.js';

/**
 * NVIDIA Parakeet TDT 0.6B v3 on the GPU through MLX — the default engine.
 *
 * It transcribes what was said rather than what a subtitler would have
 * written: whisper, trained on subtitles, tidies speech into prose and
 * sometimes rewords it, where Parakeet keeps the speaker's words. It is also
 * several times faster, and v3 detects 25 European languages on its own.
 *
 * The model runs in `parakeet_server.py`, launched with `uv run --with
 * parakeet-mlx`: uv fetches a pinned Python and the package into its own cache
 * the first time, so the only thing to install is uv itself. The weights
 * (~2.3 GB) come from Hugging Face into its usual cache on first use.
 *
 * Env: `PARAKEET_MODEL` (a Hugging Face repo or a local folder), `UV_BIN`.
 */

const MODEL = process.env.PARAKEET_MODEL || 'mlx-community/parakeet-tdt-0.6b-v3';
const PACKAGE = 'parakeet-mlx==0.5.2';
const PYTHON = '3.12';
const SCRIPT = fileURLToPath(new URL('./parakeet_server.py', import.meta.url));

/** A first run installs Python packages and pulls 2.3 GB of weights. */
const FIRST_RUN_TIMEOUT_MS = 30 * 60_000;
const START_TIMEOUT_MS = 5 * 60_000;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

function modelName(): string {
  return path.basename(MODEL);
}

function hubCache(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  if (process.env.HF_HOME) return path.join(process.env.HF_HOME, 'hub');
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub');
}

/** Weights already on disk, whether in the Hugging Face cache or a local folder. */
function modelIsLocal(): boolean {
  if (fs.existsSync(path.join(MODEL, 'model.safetensors'))) return true;
  const snapshots = path.join(hubCache(), `models--${MODEL.replace(/\//g, '--')}`, 'snapshots');
  try {
    return fs.readdirSync(snapshots).some((rev) => fs.existsSync(path.join(snapshots, rev, 'model.safetensors')));
  } catch {
    return false;
  }
}

export class ParakeetServer extends LocalModelServer {
  constructor() {
    super('parakeet-server');
  }

  protected check(): SpeechStatus {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      return { state: 'unavailable', detail: 'Parakeet needs Apple Silicon — set SPEECH_ENGINE=whisper' };
    }
    if (!findExecutable('uv', process.env.UV_BIN)) {
      return { state: 'unavailable', detail: 'uv is not installed — run `brew install uv`' };
    }
    return { state: 'idle', model: modelName() };
  }

  protected prepare(port: number): Promise<Launch> {
    const firstRun = !modelIsLocal();
    if (firstRun) this.status = { state: 'downloading', detail: `${modelName()} (2.3 GB)`, progress: 0, model: modelName() };
    return Promise.resolve({
      command: findExecutable('uv', process.env.UV_BIN)!,
      args: ['run', '--no-project', '--python', PYTHON, '--with', PACKAGE, 'python', SCRIPT, '--port', String(port), '--model', MODEL],
      model: modelName(),
      healthPath: '/health',
      startTimeoutMs: firstRun ? FIRST_RUN_TIMEOUT_MS : START_TIMEOUT_MS,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
  }

  protected override onOutput(chunk: string): void {
    if (this.status.state !== 'downloading') return;
    const progress = parakeetDownloadProgress(chunk);
    if (progress !== undefined) this.status = { ...this.status, progress };
  }

  protected async request(port: number, wav: Buffer): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array(wav),
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
    });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || body.error) throw new Error(body.error || `Speech model answered ${res.status}`);
    // Parakeet has no subtitle habits to scrub, and a clip that really was
    // "thank you" should stay one.
    return cleanTranscript(body.text || '', { whisperHabits: false });
  }
}
