import test from 'node:test';
import assert from 'node:assert';
import {
  ENV_MARKER,
  boardEnv,
  parseShellEnv,
  shellEnvCommand,
  withCommonBinDirs
} from '../../../shared/desktop/shellEnv.js';

test('the shell environment is read from after the marker, past whatever a profile printed', () => {
  const out = `Welcome back!\n${ENV_MARKER}PATH=/a:/b\0OPENAI_API_KEY=k=v\0\0stray\0`;
  assert.deepEqual(parseShellEnv(out), { PATH: '/a:/b', OPENAI_API_KEY: 'k=v' });
  assert.equal(parseShellEnv('zsh: command not found'), null);
  assert.ok(shellEnvCommand().includes(ENV_MARKER));
});

test('Homebrew joins the PATH behind what the shell already has', () => {
  assert.equal(withCommonBinDirs('/usr/local/bin:/usr/bin'), '/usr/local/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin');
  assert.equal(withCommonBinDirs(undefined), '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin');
});

test('the board gets the shell environment over the app\'s, but its address from the app', () => {
  const env = boardEnv({
    inherited: { PATH: '/usr/bin', HOME: '/Users/me', ELECTRON_RUN_AS_NODE: '1', UNSET: undefined },
    shell: { PATH: '/opt/homebrew/bin:/usr/bin', ANTHROPIC_API_KEY: 'k', HOST: 'my-mac.local', PORT: '80', NODE_OPTIONS: '--inspect' },
    port: 3737
  });
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin:/opt/homebrew/sbin:/usr/local/bin');
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
  assert.equal(env.HOME, '/Users/me');
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PORT, '3737');
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'UNSET']) assert.equal(env[name], undefined);
});

test('a shell that could not be read still leaves the board a usable PATH', () => {
  const env = boardEnv({ inherited: { PATH: '/usr/bin:/bin' }, shell: null, port: 4000 });
  assert.match(env.PATH ?? '', /\/opt\/homebrew\/bin/);
  assert.equal(env.PORT, '4000');
});
