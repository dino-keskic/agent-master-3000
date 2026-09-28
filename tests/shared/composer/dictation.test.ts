import test from 'node:test';
import assert from 'node:assert';
import {
  chooseSpeechEngine,
  cleanTranscript,
  downsample,
  encodeWav,
  formatElapsed,
  insertDictation,
  isSilent,
  mergeChunks,
  micHint,
  pickModelFile,
  parakeetDownloadProgress,
  pickVadFile,
  speechLevel
} from '../../../shared/composer/dictation.js';

test('joins recorded chunks in order', () => {
  const merged = mergeChunks([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepStrictEqual(Array.from(merged), [1, 2, 3]);
});

test('downsamples 48 kHz to 16 kHz by averaging each window', () => {
  const out = downsample(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48_000);
  assert.strictEqual(out.length, 2);
  assert.ok(Math.abs(out[0]! - 0.3) < 1e-6);
  assert.ok(Math.abs(out[1]! - 0.6) < 1e-6);
});

test('leaves audio already at or below the target rate alone', () => {
  const input = new Float32Array([0.1, 0.2]);
  assert.strictEqual(downsample(input, 16_000), input);
});

test('writes a mono 16-bit WAV header whisper-server accepts', () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1]), 16_000);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  assert.strictEqual(ascii(0), 'RIFF');
  assert.strictEqual(ascii(8), 'WAVE');
  assert.strictEqual(view.getUint16(22, true), 1);
  assert.strictEqual(view.getUint32(24, true), 16_000);
  assert.strictEqual(view.getUint16(34, true), 16);
  assert.strictEqual(view.getUint32(40, true), 6);
  assert.strictEqual(bytes.length, 50);
  assert.strictEqual(view.getInt16(46, true), 0x7fff);
  assert.strictEqual(view.getInt16(48, true), -0x8000);
});

test('clamps samples that clip instead of wrapping around', () => {
  const view = new DataView(encodeWav(new Float32Array([2])).buffer);
  assert.strictEqual(view.getInt16(44, true), 0x7fff);
});

test('meters silence at zero and talking visibly above it', () => {
  assert.strictEqual(speechLevel(new Float32Array(100)), 0);
  assert.ok(speechLevel(new Float32Array(100).fill(0.05)) > 0.5);
  assert.strictEqual(speechLevel(new Float32Array(100).fill(1)), 1);
});

test('tells a muted mic from a quiet speaker', () => {
  assert.ok(isSilent(new Float32Array(16_000).fill(0.001)));
  const clip = new Float32Array(16_000);
  clip.fill(0.05, 8_000, 9_000);
  assert.ok(!isSilent(clip));
});

test('strips whisper non-speech tags and joins lines', () => {
  assert.strictEqual(cleanTranscript(' Run the tests\n and [BLANK_AUDIO] push. (music) *coughs*'), 'Run the tests and push.');
});

test('keeps parentheses that are part of what was said', () => {
  assert.strictEqual(cleanTranscript('Call foo (the helper) first.'), 'Call foo (the helper) first.');
});

test('drops the stock sentence whisper hears in silence', () => {
  assert.strictEqual(cleanTranscript(' Thank you.'), '');
  assert.strictEqual(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.strictEqual(cleanTranscript('Thank you, now fix the bug.'), 'Thank you, now fix the bug.');
});

test('inserts into an empty box as said', () => {
  assert.deepStrictEqual(insertDictation('', 0, 0, 'Fix the build.'), { text: 'Fix the build.', cursor: 14 });
});

test('continues a sentence without whisper’s capital', () => {
  const result = insertDictation('Please', 6, 6, 'Fix the build.');
  assert.strictEqual(result.text, 'Please fix the build.');
  assert.strictEqual(result.cursor, result.text.length);
});

test('starts a new sentence after a full stop, with a space', () => {
  assert.strictEqual(insertDictation('Done.', 5, 5, 'Now test.').text, 'Done. Now test.');
});

test('keeps the capital on I and acronyms mid-sentence', () => {
  assert.strictEqual(insertDictation('and', 3, 3, 'I think so').text, 'and I think so');
  assert.strictEqual(insertDictation('call the', 8, 8, 'API twice').text, 'call the API twice');
  assert.strictEqual(insertDictation('open', 4, 4, 'OpenCode').text, 'open OpenCode');
});

test('replaces a selection and spaces itself from the text after', () => {
  const result = insertDictation('fix XXX now', 4, 7, 'The login.');
  assert.strictEqual(result.text, 'fix the login now');
  assert.strictEqual(result.cursor, 'fix the login'.length);
});

test('does not add a space before punctuation that follows', () => {
  assert.strictEqual(insertDictation('see ,', 4, 4, 'this').text, 'see this,');
});

test('ignores an empty clip', () => {
  assert.deepStrictEqual(insertDictation('abc', 1, 2, '  '), { text: 'abc', cursor: 2 });
});

test('formats the recording clock', () => {
  assert.strictEqual(formatElapsed(7.9), '0:07');
  assert.strictEqual(formatElapsed(125), '2:05');
});

test('explains the button in each model state', () => {
  assert.match(micHint({ state: 'unavailable', detail: 'brew install whisper-cpp' }, false), /brew install/);
  assert.match(micHint({ state: 'downloading', progress: 0.42 }, false), /42%/);
  assert.match(micHint({ state: 'ready' }, true), /Esc/);
});

test('prefers the full turbo model, then its quantised builds', () => {
  assert.strictEqual(pickModelFile(['ggml-base.en.bin', 'ggml-large-v3-turbo-q5_0.bin']), 'ggml-large-v3-turbo-q5_0.bin');
  assert.strictEqual(pickModelFile(['ggml-large-v3-turbo.bin', 'ggml-large-v3-turbo-q5_0.bin']), 'ggml-large-v3-turbo.bin');
  assert.strictEqual(pickModelFile(['notes.txt']), undefined);
});

test('finds the newest silero VAD model', () => {
  assert.strictEqual(pickVadFile(['ggml-silero-v5.1.2.bin', 'ggml-silero-v6.2.0.bin', 'x.bin']), 'ggml-silero-v6.2.0.bin');
  assert.strictEqual(pickVadFile([]), undefined);
});

test('keeps a real "thank you" from Parakeet, which has no silence habit', () => {
  assert.strictEqual(cleanTranscript(' Thank you.\n', { whisperHabits: false }), 'Thank you.');
  assert.strictEqual(cleanTranscript('Keep [this] as said', { whisperHabits: false }), 'Keep [this] as said');
});

test('runs Parakeet on Apple Silicon with uv, whisper otherwise, and obeys SPEECH_ENGINE', () => {
  const mac = { appleSilicon: true, uv: true, whisper: true };
  assert.strictEqual(chooseSpeechEngine(undefined, mac), 'parakeet');
  assert.strictEqual(chooseSpeechEngine('Whisper', mac), 'whisper');
  assert.strictEqual(chooseSpeechEngine(undefined, { ...mac, uv: false }), 'whisper');
  assert.strictEqual(chooseSpeechEngine(undefined, { appleSilicon: true, uv: false, whisper: false }), 'parakeet');
  assert.strictEqual(chooseSpeechEngine('nonsense', { appleSilicon: false, uv: true, whisper: false }), 'whisper');
});

test('reads the weights download progress from Hugging Face’s bar', () => {
  assert.strictEqual(parakeetDownloadProgress('config.json: 100%|██| 3k\rmodel.safetensors:  12%|▎ |\rmodel.safetensors:  42%|█'), 0.42);
  assert.strictEqual(parakeetDownloadProgress('config.json: 100%|██████|'), undefined);
});
