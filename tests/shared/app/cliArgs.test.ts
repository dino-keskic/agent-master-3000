import test from 'node:test';
import assert from 'node:assert';
import { cliHelp, parseCliArgs } from '../../../shared/app/cliArgs.js';

test('no arguments means every default', () => {
  assert.deepStrictEqual(parseCliArgs([]), { ok: true, options: { paths: false, help: false, version: false } });
});

test('value flags take the next argument or an = value', () => {
  const parsed = parseCliArgs(['--port', '4000', '--host=0.0.0.0', '--data-dir', './state']);
  assert.deepStrictEqual(parsed, {
    ok: true,
    options: { paths: false, help: false, version: false, port: 4000, host: '0.0.0.0', dataDir: './state' }
  });
  assert.deepStrictEqual(parseCliArgs(['-p', '8080']), { ok: true, options: { paths: false, help: false, version: false, port: 8080 } });
});

test('help and version', () => {
  assert.deepStrictEqual(parseCliArgs(['-h']), { ok: true, options: { paths: false, help: true, version: false } });
  assert.deepStrictEqual(parseCliArgs(['--version']), { ok: true, options: { paths: false, help: false, version: true } });
});

test('a bad port is refused, not coerced', () => {
  for (const port of ['0', '65536', 'abc', '80.5', '-1']) {
    const parsed = parseCliArgs(['--port', port]);
    assert.strictEqual(parsed.ok, false, port);
  }
});

test('an unknown option or a missing value is an error', () => {
  assert.deepStrictEqual(parseCliArgs(['--prot', '1']), { ok: false, error: "unknown option '--prot'" });
  assert.deepStrictEqual(parseCliArgs(['--host']), { ok: false, error: "option '--host' needs a value" });
  assert.deepStrictEqual(parseCliArgs(['--data-dir=']), { ok: false, error: "option '--data-dir' needs a value" });
});

test('the help names the version and the default port', () => {
  const help = cliHelp('1.2.3', 3737);
  assert.match(help, /agent-master-3000 1\.2\.3/);
  assert.match(help, /default 3737/);
});

test('--config names the setup file, and --paths only reports', () => {
  assert.deepStrictEqual(parseCliArgs(['--config', './setup.json', '--paths']), {
    ok: true,
    options: { paths: true, help: false, version: false, config: './setup.json' }
  });
  assert.match(cliHelp('1.2.3', 3737), /--config <file>/);
});
