import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_DICTATION_SECONDS,
  MIN_DICTATION_SECONDS,
  SpeechStatus,
  downsample,
  encodeWav,
  isSilent,
  mergeChunks,
  speechLevel
} from '../../shared/composer/dictation';
import { api } from '../api';
import { reportError } from '../app/notify';

/**
 * One mic button's recording: open the microphone, keep every sample, and on
 * stop send the clip to the local model and hand back what was said.
 *
 * Raw samples are tapped with an AudioWorklet rather than MediaRecorder, whose
 * webm/opus would need ffmpeg on the server to undo. Echo cancellation and
 * gain control stay on; the browser's noise suppression is off — it smears
 * consonants, and the models are trained on noisy speech and do better with
 * the room left in than with words carved out of it.
 *
 * The model is asked to load the moment recording starts, so the couple of
 * seconds that takes are spent while the user is still talking.
 */

export type DictationPhase = 'idle' | 'opening' | 'recording' | 'transcribing';

export interface Dictation {
  phase: DictationPhase;
  /** 0..1, smoothed, while recording. */
  level: number;
  /** Seconds recorded so far. */
  elapsed: number;
  status?: SpeechStatus;
  /** Start, or stop and transcribe. */
  toggle: () => void;
  /** Stop and throw the clip away. */
  cancel: () => void;
}

const TAP_PROCESSOR = `
class DictationTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('dictation-tap', DictationTap);
`;

let tapUrl: string | undefined;
function tapModuleUrl(): string {
  tapUrl ??= URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: 'application/javascript' }));
  return tapUrl;
}

/** Shared by every mic on the page, so a board with three composers asks once. */
let statusCache: { at: number; status: SpeechStatus } | undefined;
const STATUS_TTL_MS = 30_000;

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  chunks: Float32Array[];
  startedAt: number;
  stopTimer: number;
}

function microphoneError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow it for this page in the browser’s site settings.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return e instanceof Error ? e.message : 'Could not open the microphone.';
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<SpeechStatus | undefined>(statusCache?.status);

  const recording = useRef<Recording | undefined>(undefined);
  const smoothed = useRef(0);
  const phaseRef = useRef<DictationPhase>('idle');
  const latestOnText = useRef(onText);
  const mounted = useRef(true);

  useEffect(() => {
    latestOnText.current = onText;
  }, [onText]);

  const move = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.speechStatus();
      statusCache = { at: Date.now(), status: next };
      if (mounted.current) setStatus(next);
      return next;
    } catch {
      return statusCache?.status;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!statusCache || Date.now() - statusCache.at > STATUS_TTL_MS) void refreshStatus();
    return () => {
      mounted.current = false;
    };
  }, [refreshStatus]);

  /** Release the mic and the audio graph; returns what was recorded. */
  const teardown = useCallback((): { samples: Float32Array; rate: number } | undefined => {
    const current = recording.current;
    if (!current) return undefined;
    recording.current = undefined;
    window.clearTimeout(current.stopTimer);
    current.stream.getTracks().forEach((track) => track.stop());
    const rate = current.context.sampleRate;
    void current.context.close().catch(() => undefined);
    smoothed.current = 0;
    if (mounted.current) setLevel(0);
    return { samples: mergeChunks(current.chunks), rate };
  }, []);

  useEffect(() => () => void teardown(), [teardown]);

  const stop = useCallback(async () => {
    const clip = teardown();
    if (!clip) return;
    const seconds = clip.samples.length / clip.rate;
    if (seconds < MIN_DICTATION_SECONDS) return move('idle');
    if (isSilent(clip.samples)) {
      reportError('Didn’t hear anything', 'Check that the right microphone is selected and not muted.');
      return move('idle');
    }

    move('transcribing');
    // While the model is still downloading or loading, show how far along it is.
    const poll = window.setInterval(() => void refreshStatus(), 800);
    try {
      const wav = encodeWav(downsample(clip.samples, clip.rate));
      const { text } = await api.transcribe(new Blob([wav as BlobPart], { type: 'audio/wav' }));
      if (text) latestOnText.current(text);
      else reportError('Didn’t catch that', 'Nothing recognisable was said. Try again a little closer to the mic.');
    } catch (e) {
      reportError('Dictation failed', e);
    } finally {
      window.clearInterval(poll);
      void refreshStatus();
      move('idle');
    }
  }, [move, refreshStatus, teardown]);

  const start = useCallback(async () => {
    if (status?.state === 'unavailable') {
      reportError('Dictation unavailable', status.detail);
      return;
    }
    move('opening');
    void api.warmSpeech().then((next) => {
      statusCache = { at: Date.now(), status: next };
      if (mounted.current) setStatus(next);
    }).catch(() => undefined);

    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      const context = new AudioContext();
      await context.audioWorklet.addModule(tapModuleUrl());
      if (phaseRef.current !== 'opening') {
        // Cancelled or unmounted while the permission prompt was up.
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        return;
      }

      const source = context.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(context, 'dictation-tap');
      // A worklet only runs while the graph pulls on it; a muted gain to the
      // speakers is the pull, without playing the user back to themselves.
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(tap).connect(mute).connect(context.destination);

      const chunks: Float32Array[] = [];
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunks.push(event.data);
        smoothed.current = Math.max(speechLevel(event.data), smoothed.current * 0.9);
      };

      recording.current = {
        stream,
        context,
        chunks,
        startedAt: performance.now(),
        stopTimer: window.setTimeout(() => void stop(), MAX_DICTATION_SECONDS * 1000)
      };
      move('recording');
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      move('idle');
      reportError('Could not start dictation', microphoneError(e));
    }
  }, [move, status, stop]);

  // The meter and clock, at frame rate, only while recording.
  useEffect(() => {
    if (phase !== 'recording') return;
    let frame = 0;
    const tick = () => {
      const current = recording.current;
      if (current) {
        setLevel(smoothed.current);
        setElapsed((performance.now() - current.startedAt) / 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const cancel = useCallback(() => {
    teardown();
    move('idle');
  }, [move, teardown]);

  // Escape discards — caught before the textarea or the drawer see it, since
  // both close something on Escape.
  useEffect(() => {
    if (phase !== 'recording') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, cancel]);

  const toggle = useCallback(() => {
    if (phaseRef.current === 'idle') void start();
    else if (phaseRef.current === 'recording') void stop();
  }, [start, stop]);

  return { phase, level, elapsed, status, toggle, cancel };
}
