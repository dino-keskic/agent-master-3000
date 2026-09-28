import test from 'node:test';
import assert from 'node:assert';
import {
  LocationStatus,
  SetupReport,
  assessLocation,
  envKeyProblem,
  formatEnvLines,
  formatSetupReport,
  needsBoardRestart,
  normalizePathInput,
  parseEnvLines,
  setupSeverity,
  sourceLabel
} from '../../../shared/setup/report.js';

test('a file where a folder belongs, and the other way round, is an error', () => {
  assert.strictEqual(assessLocation('dataDir', { exists: true, kind: 'file' }).severity, 'error');
  assert.strictEqual(assessLocation('opencodeBin', { exists: true, kind: 'dir' }).severity, 'error');
});

test('a data folder that is missing is fine if it can be created', () => {
  assert.strictEqual(assessLocation('dataDir', { exists: false, creatable: true }).severity, 'ok');
  assert.strictEqual(assessLocation('dataDir', { exists: false, creatable: false }).severity, 'error');
  assert.strictEqual(assessLocation('dataDir', { exists: true, kind: 'dir', writable: false }).severity, 'error');
  assert.match(assessLocation('dataDir', { exists: true, kind: 'dir', writable: true, hasBoard: true }).note, /board is here/);
});

test('no OpenCode, or one that cannot run, stops tasks; the rest only warn when missing', () => {
  assert.strictEqual(assessLocation('opencodeBin', { exists: false }).severity, 'error');
  assert.strictEqual(assessLocation('opencodeBin', { exists: true, kind: 'file', executable: false }).severity, 'error');
  assert.strictEqual(assessLocation('opencodeBin', { exists: true, kind: 'file', executable: true }).severity, 'ok');
  for (const key of ['opencodeConfigDir', 'opencodeDb', 'opencodeModels'] as const) {
    assert.strictEqual(assessLocation(key, { exists: false }).severity, 'warn', key);
  }
});

test('a file that is not an OpenCode database is an error', () => {
  assert.strictEqual(assessLocation('opencodeDb', { exists: true, kind: 'file', looksLikeDb: false }).severity, 'error');
  assert.strictEqual(assessLocation('opencodeDb', { exists: true, kind: 'file', looksLikeDb: true }).severity, 'ok');
});

test('typed paths lose quotes and trailing slashes, and ~ expands', () => {
  assert.strictEqual(normalizePathInput('  "/a/b/"  ', '/home/me'), '/a/b');
  assert.strictEqual(normalizePathInput('~', '/home/me'), '/home/me');
  assert.strictEqual(normalizePathInput('~/x/', '/home/me/'), '/home/me/x');
  assert.strictEqual(normalizePathInput('/', '/home/me'), '/');
  assert.strictEqual(normalizePathInput('C:\\Users\\me\\', '/home/me'), 'C:\\Users\\me');
  assert.strictEqual(normalizePathInput('C:\\', '/home/me'), 'C:\\');
});

test('a relative path is refused', () => {
  assert.strictEqual(normalizePathInput('data', '/home/me'), null);
  assert.strictEqual(normalizePathInput('./x', '/home/me'), null);
  assert.strictEqual(normalizePathInput('', '/home/me'), null);
});

test('env lines: export, quotes, comments and blanks', () => {
  const { env, errors } = parseEnvLines('# proxy\nexport HTTPS_PROXY="http://p:8080"\n\nXDG_DATA_HOME = /x \n');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(env, { HTTPS_PROXY: 'http://p:8080', XDG_DATA_HOME: '/x' });
  assert.deepStrictEqual(parseEnvLines(formatEnvLines(env)).env, env);
});

test('env lines that are not NAME=value, or set a location, are refused by line', () => {
  const { env, errors } = parseEnvLines('OK=1\nnot a line\nOPENCODE_DB=/x\nBOARD_TOKEN=t');
  assert.deepStrictEqual(env, { OK: '1' });
  assert.strictEqual(errors.length, 3);
  assert.match(errors[0]!, /^Line 2/);
  assert.match(errors[1]!, /OpenCode sessions/);
  assert.match(errors[2]!, /managed by the board/);
});

test('envKeyProblem only objects to what the board owns', () => {
  assert.strictEqual(envKeyProblem('HTTPS_PROXY'), undefined);
  assert.ok(envKeyProblem('OPENCODE_CONFIG_DIR'));
  assert.ok(envKeyProblem('OPENCODE_CONFIG_CONTENT'));
});

test('the worst location decides the header button', () => {
  assert.strictEqual(setupSeverity([]), 'ok');
  assert.strictEqual(setupSeverity([{ severity: 'ok' }, { severity: 'warn' }]), 'warn');
  assert.strictEqual(setupSeverity([{ severity: 'warn' }, { severity: 'error' }]), 'error');
});

function status(partial: Partial<LocationStatus>): LocationStatus {
  return { key: 'dataDir', value: '/d', source: 'default', severity: 'ok', note: 'Found.', ...partial };
}

test('a data folder other than the one in use waits for a restart', () => {
  assert.strictEqual(needsBoardRestart({ locations: [status({})], dataDirInUse: '/d' }), false);
  assert.strictEqual(needsBoardRestart({ locations: [status({ value: '/e' })], dataDirInUse: '/d' }), true);
});

test('the source reads as the variable that set it', () => {
  assert.strictEqual(sourceLabel({ source: 'env', envVar: 'OPENCODE_DB' }), 'from $OPENCODE_DB');
  assert.strictEqual(sourceLabel({ source: 'config' }), 'set in the setup file');
  assert.strictEqual(sourceLabel({ source: 'detected' }), 'found');
});

test('--paths prints every location with its mark, and what is pending', () => {
  const report: SetupReport = {
    configFile: '/c/config.json',
    locations: [
      status({}),
      status({ key: 'opencodeBin', value: 'opencode', severity: 'error', note: 'Missing.' })
    ],
    opencodeEnv: { HTTPS_PROXY: 'x' },
    binCandidates: [],
    dataDirInUse: '/d',
    pendingMove: { from: '/old', to: '/d' }
  };
  const text = formatSetupReport(report);
  assert.match(text, /^Setup file: \/c\/config\.json/);
  assert.match(text, /✓ Board data: \/d/);
  assert.match(text, /✗ OpenCode program: opencode\n {4}default — Missing\./);
  assert.match(text, /Extra OpenCode environment: HTTPS_PROXY/);
  assert.match(text, /copied from \/old/);
});
