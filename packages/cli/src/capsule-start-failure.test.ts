import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { commandFixture, removeFixture, runCli } from './capsule-command.fixture.js';

for (const mode of ['--silent', '--non-interactive', '--interactive']) {
  void test(`start ${mode} retains a failed manager session while keeping JSON stdout parseable`, async () => {
    const fixture = await commandFixture('stopped');
    try {
      const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'start', '--system', 'orders', '--env', 'API_TOKEN=private-test-value', mode, '--no-color', '--json'] });
      assert.equal(result.status, 1, result.stderr);
      const failure = JSON.parse(result.stdout);
      assert.equal(failure.kind, 'capsule-operation-failed');
      assert.equal(failure.operation, 'start');
      const sessionId: unknown = failure.sessionId;
      assert.equal(typeof sessionId, 'string');
      if (typeof sessionId !== 'string') { throw new Error('Expected session ID'); }
      assert.match(sessionId, /^[a-z]+-[a-z]+-[a-z]+$/u);
      assert.doesNotMatch(result.stdout + result.stderr, /private-test-value/u);
      assert.equal(result.stdout.includes('\u001b'), false);
      if (mode === '--interactive') {
        assert.ok(result.stderr.includes('\u001b[2K'), 'interactive redraw must use cursor control without color');
        assert.doesNotMatch(result.stderr, new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'u'));
        assert.match(result.stderr, /Capsule start failed/u);
      } else { assert.equal(result.stderr.includes('\u001b'), false); }
      const sessionsRoot = dirname(fixture.artifactRoot);
      assert.deepEqual((await readdir(sessionsRoot)).sort(), [fixture.sessionId, sessionId].map(id => `capsule-${id}`).sort());
      const record = JSON.parse(await readFile(join(sessionsRoot, `capsule-${sessionId}`, 'session.json'), 'utf8'));
      assert.equal(record.state, 'manager-failed');
      assert.equal(record.cleanup.kind, 'not-attempted');
      assert.ok(record.error.message.length > 0);
      if (mode === '--silent') { assert.doesNotMatch(result.stderr, /session .* admitted|manager spawned/u); }
      else if (mode === '--interactive') { assert.match(result.stderr, /Session — /u); }
      else { assert.match(result.stderr, /session .* admitted/u); }
    } finally { await removeFixture(fixture.directory); }
  });
}
