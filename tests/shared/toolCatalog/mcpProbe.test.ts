import test from 'node:test';
import assert from 'node:assert';
import { mcpProbeKey } from '../../../shared/toolCatalog/mcpProbe.js';

test('a server started the same way is one answer in every folder', () => {
  const entry = { command: ['npx', '-y', '@acme/mcp-server'], environment: { TOKEN: 'x' } };
  assert.strictEqual(mcpProbeKey(entry, '/work/a'), mcpProbeKey(entry, '/work/b'));
  assert.strictEqual(
    mcpProbeKey({ command: ['/usr/local/bin/mcp'] }, '/work/a'),
    mcpProbeKey({ command: ['/usr/local/bin/mcp'] }, '/work/b')
  );
});

test('a different command or environment is a different server', () => {
  const base = { command: ['npx', '-y', '@acme/mcp-server'] };
  assert.notStrictEqual(mcpProbeKey(base, '/w'), mcpProbeKey({ command: ['npx', '-y', '@acme/other'] }, '/w'));
  assert.notStrictEqual(mcpProbeKey(base, '/w'), mcpProbeKey({ ...base, environment: { A: '1' } }, '/w'));
  assert.strictEqual(
    mcpProbeKey({ ...base, environment: { A: '1', B: '2' } }, '/w'),
    mcpProbeKey({ ...base, environment: { B: '2', A: '1' } }, '/w'),
    'the order the environment was written in does not matter'
  );
});

test('a command naming a path relative to the folder is kept per folder', () => {
  for (const command of [
    ['node', './mcp.js'],
    ['node', '../tools/mcp.js'],
    ['mcp-server-git', '--repository', '.'],
    ['mcp-server-git', '--repository=.'],
    ['bin/mcp']
  ]) {
    assert.notStrictEqual(mcpProbeKey({ command }, '/work/a'), mcpProbeKey({ command }, '/work/b'), command.join(' '));
  }
});
