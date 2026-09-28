/**
 * Dictation: the decisions between a microphone and the words in a prompt box.
 *
 * The browser records at whatever rate the sound card runs, the models want
 * 16 kHz mono PCM in a WAV, and what comes back is text with the model's habits
 * in it — whisper's non-speech tags and stock sentence for silence, a capital
 * at the start of every clip. Turning one into the other, and deciding how a clip lands
 * beside what was already typed, is all here so the tests can reach it. The
 * recording itself is `src/speech/`; the model is `server/speech/`.
 */

/** What both Parakeet and whisper were trained on, and what their servers read without ffmpeg. */
export const SPEECH_SAMPLE_RATE = 16_000;

/** A clip runs until stopped, but not forever: five minutes is ~9.6 MB of WAV. */
export const MAX_DICTATION_SECONDS = 300;

/** Shorter than this is a mis-click, not a sentence. */
export const MIN_DICTATION_SECONDS = 0.3;

/** Where the local model is. `unavailable` means it cannot be run at all. */
export type SpeechState = 'unavailable' | 'idle' | 'downloading' | 'starting' | 'ready' | 'error';

export interface SpeechStatus {
  state: SpeechState;
  /** Why it is unavailable or failed, or what is being downloaded. */
  detail?: string;
  /** 0..1 while downloading. */
  progress?: number;
  /** The model in use, e.g. `parakeet-tdt-0.6b-v3` or `ggml-large-v3-turbo.bin`. */
  model?: string;
}

/** One buffer from a run of recorded chunks. */
export function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Resample to a lower rate by averaging each output sample's window.
 *
 * The average is the low-pass: picking every third sample of 48 kHz would fold
 * everything above 8 kHz back into the speech band as hiss. Upsampling is never
 * needed (no mic records below 16 kHz), so a lower input is returned untouched.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = SPEECH_SAMPLE_RATE): Float32Array {
  if (fromRate <= toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

/** Mono 16-bit PCM WAV bytes. */
export function encodeWav(samples: Float32Array, sampleRate = SPEECH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/**
 * How loud a chunk is, 0..1, for the meter on the button.
 *
 * Speech RMS sits around 0.02–0.2, so it is scaled up and square-rooted to
 * make ordinary talking move the meter visibly without shouting.
 */
export function speechLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.sqrt(rms * 8));
}

/** Below this peak RMS nothing was said — a muted mic, or the wrong input. */
const SILENCE_RMS = 0.004;

/** True when a whole clip never rose above room noise. */
export function isSilent(samples: Float32Array, windowSize = 1600): boolean {
  for (let start = 0; start < samples.length; start += windowSize) {
    const window = samples.subarray(start, start + windowSize);
    let sum = 0;
    for (let i = 0; i < window.length; i++) sum += window[i]! * window[i]!;
    if (Math.sqrt(sum / Math.max(1, window.length)) > SILENCE_RMS) return false;
  }
  return true;
}

/**
 * What whisper says when there was nothing to hear. It learned them from
 * subtitled video, so a clip of breathing comes back as a sign-off. Only a
 * transcript that is *entirely* one of these is dropped.
 */
const SILENCE_PHRASES = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'bye',
  'okay',
  'so',
  'hmm'
]);

/**
 * A model's output as prompt text: one line, and nothing at all for a clip
 * that was only silence. With `whisperHabits` (the default) it also drops
 * `[BLANK_AUDIO]` / `(music)` / `*coughs*` tags and a transcript that is only
 * whisper's stock sentence for silence; Parakeet has neither habit, so for it
 * a dictated "Thank you." stays.
 */
export function cleanTranscript(raw: string, { whisperHabits = true }: { whisperHabits?: boolean } = {}): string {
  if (!whisperHabits) return raw.replace(/\s+/g, ' ').trim();
  const text = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*\b(?:music|silence|noise|applause|laugh\w*|cough\w*|inaudible|blank\w*)\b[^)]*)\)/gi, ' ')
    .replace(/\*[^*]+\*/g, ' ')
    .replace(/♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = text.toLowerCase().replace(/[.!?,…\s]+$/g, '').trim();
  return SILENCE_PHRASES.has(bare) ? '' : text;
}

/** A word whisper is right to capitalise even mid-sentence: `I`, `I'm`, `API`, `OpenCode`. */
function keepsCapital(word: string): boolean {
  return /^I(?:'|’|$)/.test(word) || /^[A-Z][A-Z0-9]/.test(word) || /^[A-Z]\w*[A-Z]/.test(word);
}

/**
 * Put a dictated clip where the caret is, as if it had been typed there.
 *
 * Replaces a selection; spaces itself off from the words either side; and when
 * it lands mid-sentence, drops the capital whisper gives every clip's first
 * word — "fix the |" + "The tests." reads "fix the the tests.", not "The".
 */
export function insertDictation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  clip: string
): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  let words = clip.trim();
  if (!words) return { text: value, cursor: end };

  const before = value.slice(0, start);
  const after = value.slice(end);
  const lastChar = before.trimEnd().slice(-1);
  const midSentence = lastChar !== '' && !/[.!?:\n]/.test(lastChar) && !/\n\s*$/.test(before);
  const firstWord = words.split(/\s/)[0]!;
  if (midSentence && !keepsCapital(firstWord)) words = words.charAt(0).toLowerCase() + words.slice(1);

  // Continuing a sentence that goes on after the caret: whisper's closing full
  // stop would end it early.
  if (/^\s*[a-z]/.test(after)) words = words.replace(/[.]$/, '');

  const lead = before === '' || /\s$/.test(before) ? '' : ' ';
  const trail = after === '' || /^[\s.,!?;:)]/.test(after) ? '' : ' ';
  const inserted = `${lead}${words}${trail}`;
  return { text: before + inserted + after, cursor: start + inserted.length };
}

/** `0:07` */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What the button says it will do, or why it cannot. */
export function micHint(status: SpeechStatus | undefined, recording: boolean): string {
  if (recording) return 'Stop and transcribe (Esc to discard)';
  if (!status) return 'Dictate';
  switch (status.state) {
    case 'unavailable':
      return `Dictation unavailable: ${status.detail || 'no local speech model'}`;
    case 'downloading':
      return `Downloading speech model${status.progress !== undefined ? ` ${Math.round(status.progress * 100)}%` : ''}…`;
    case 'starting':
      return 'Dictate (loading speech model…)';
    case 'error':
      return `Dictate (last start failed: ${status.detail || 'unknown error'})`;
    default:
      return 'Dictate — runs locally';
  }
}

/**
 * The model file to load from a folder of them, best first. The full-precision
 * turbo is the one worth having; the quantised turbos are nearly as good at a
 * third of the size; anything else whisper.cpp can load is better than nothing.
 */
const MODEL_PREFERENCE = [
  'ggml-large-v3-turbo.bin',
  'ggml-large-v3-turbo-q8_0.bin',
  'ggml-large-v3-turbo-q5_0.bin',
  'ggml-large-v3.bin',
  'ggml-medium.en.bin',
  'ggml-medium.bin',
  'ggml-small.en.bin',
  'ggml-small.bin',
  'ggml-base.en.bin',
  'ggml-base.bin'
];

export function pickModelFile(files: string[]): string | undefined {
  const present = new Set(files);
  return MODEL_PREFERENCE.find((name) => present.has(name));
}

/** A voice-activity model in the same folder, if there is one. */
export function pickVadFile(files: string[]): string | undefined {
  return files.filter((name) => /^ggml-silero-v[\d.]+\.bin$/.test(name)).sort().pop();
}

export type SpeechEngine = 'parakeet' | 'whisper';

/**
 * Which engine to run. An explicit `SPEECH_ENGINE` wins. Otherwise Parakeet —
 * it keeps the speaker's words where whisper rewrites them — wherever it can
 * run, then whisper.cpp if it is installed. With neither ready, the engine
 * this machine *could* run is chosen, so its status says what to install.
 */
export function chooseSpeechEngine(
  requested: string | undefined,
  have: { appleSilicon: boolean; uv: boolean; whisper: boolean }
): SpeechEngine {
  const asked = requested?.trim().toLowerCase();
  if (asked === 'parakeet' || asked === 'whisper') return asked;
  if (have.appleSilicon && have.uv) return 'parakeet';
  if (have.whisper) return 'whisper';
  return have.appleSilicon ? 'parakeet' : 'whisper';
}

/**
 * How far the weights download is, from a chunk of the Parakeet server's
 * stderr — Hugging Face's progress bar, `model.safetensors:  42%|███▎  |`.
 * Only the weights file counts; the config before it is a few kilobytes.
 */
export function parakeetDownloadProgress(chunk: string): number | undefined {
  const matches = [...chunk.matchAll(/model\.safetensors:\s*(\d{1,3})%/g)];
  const last = matches.pop();
  return last ? Math.min(100, Number(last[1])) / 100 : undefined;
}
