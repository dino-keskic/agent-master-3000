import { chooseSpeechEngine } from '../../shared/composer/dictation.js';
import { LocalModelServer, findExecutable } from './modelServer.js';
import { ParakeetServer } from './parakeet.js';
import { WhisperServer } from './whisper.js';

/**
 * The one speech engine this board runs, picked at startup: `SPEECH_ENGINE`
 * when set, otherwise Parakeet where it can run and whisper.cpp where not.
 */

const engine = chooseSpeechEngine(process.env.SPEECH_ENGINE, {
  appleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
  uv: Boolean(findExecutable('uv', process.env.UV_BIN)),
  whisper: Boolean(findExecutable('whisper-server', process.env.WHISPER_SERVER_BIN))
});

export const speech: LocalModelServer = engine === 'parakeet' ? new ParakeetServer() : new WhisperServer();
