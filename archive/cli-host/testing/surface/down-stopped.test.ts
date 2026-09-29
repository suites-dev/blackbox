import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPSULE_A, projectFixture } from './project.fixture.js';
import { capsule, onlyDocument } from './run-cli.fixture.js';

void test('down --json on a stopped capsule is capsule-stopped plus capsule and next', async () => {
  const fixture = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'stopped',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [],
    },
  ]);
  try {
    const result = await capsule(fixture.directory, 'down', CAPSULE_A, '--json');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(onlyDocument(result), {
      kind: 'capsule-stopped',
      sessionId: CAPSULE_A,
      cleanup: 'complete',
      alreadyStopped: true,
      capsule: CAPSULE_A,
      warnings: [],
      next: [`blackbox capsule report ${CAPSULE_A}`],
    });
    const human = await capsule(fixture.directory, 'down', CAPSULE_A);
    assert.equal(human.stdout, '');
    assert.equal(
      human.stderr,
      `capsule ${CAPSULE_A} was already stopped · evidence kept\n→ blackbox capsule report ${CAPSULE_A}\n`,
    );
  } finally {
    await fixture.remove();
  }
});
