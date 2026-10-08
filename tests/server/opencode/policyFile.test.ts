import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeBoardPolicyFile } from '../../../server/opencode/policyFile.js';

/**
 * The write OpenCode 2's watcher sees. The version probe is not tested here:
 * it would run the host's OpenCode, which tests never do.
 */

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-file-'));
  return path.join(dir, 'nested', 'board_state.opencode.json');
}

test('the policy lands whole, with no temp file left beside it', () => {
  const file = tmpFile();
  writeBoardPolicyFile({ grep: false }, file);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { tools: { grep: false } });
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)]);
});

test('a file that already says this is not rewritten, so nothing reloads for it', () => {
  const file = tmpFile();
  writeBoardPolicyFile({ grep: false }, file);
  const before = fs.statSync(file).ino;
  writeBoardPolicyFile({ grep: false }, file);
  assert.strictEqual(fs.statSync(file).ino, before);
  writeBoardPolicyFile({ grep: true }, file);
  assert.notStrictEqual(fs.statSync(file).ino, before);
});
