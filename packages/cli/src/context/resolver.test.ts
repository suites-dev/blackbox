import assert from 'node:assert/strict';
import test from 'node:test';

import { CliFailure } from '../cli/failure.js';
import {
  ACTIVITY_A,
  ACTIVITY_A2,
  ACTIVITY_B,
  CAPSULE_A,
  CAPSULE_B,
  TRACE_A,
  TRACE_B,
  fixtureActivity,
  projectFixture,
  twoCapsuleProject,
} from '../testing/surface/project.fixture.js';
import { shortActivityId } from './display.js';
import { setCurrentCapsule } from './current-capsule.js';
import { InvocationContext } from './invocation.js';
import { ProjectIndex } from './project-index.js';
import { resolveId, type Resolved, type SearchScope } from './resolver.js';

const PROJECT = { kind: 'project' } satisfies SearchScope;

async function failureOf(promise: Promise<Resolved>): Promise<CliFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliFailure) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a CliFailure');
}

function described(resolved: Resolved): string {
  const id =
    resolved.kind === 'capsule'
      ? ''
      : resolved.kind === 'activity'
        ? resolved.activity.activityId
        : resolved.traceId;
  return `${resolved.kind}:${resolved.capsule.capsule}:${id}`;
}

void test('capsule IDs match exactly; a capsule prefix is unknown', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    assert.equal(described(await resolveId(index, CAPSULE_B, PROJECT)), `capsule:${CAPSULE_B}:`);
    const failure = await failureOf(resolveId(index, CAPSULE_B.slice(0, -1), PROJECT));
    assert.equal(failure.detail.code, 'id-unknown');
    assert.deepEqual(failure.detail.next, ['blackbox ls --all']);
  } finally {
    await fixture.remove();
  }
});

void test('full hyphenated UUIDs and hyphenated or unhyphenated prefixes resolve activities', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    const expected = `activity:${CAPSULE_A}:${ACTIVITY_A}`;
    for (const input of [ACTIVITY_A, '3f9a2c41-7b', '3f9a2c417b', '3f9a2c41-7b00-40']) {
      assert.equal(described(await resolveId(index, input, PROJECT)), expected, input);
    }
    assert.equal(
      described(await resolveId(index, '9b1e0d', PROJECT)),
      `activity:${CAPSULE_B}:${ACTIVITY_B}`,
    );
    assert.equal((await failureOf(resolveId(index, '9b1e0', PROJECT))).detail.code, 'id-unknown');
  } finally {
    await fixture.remove();
  }
});

void test('32 hex characters without hyphens resolve only as a trace', async () => {
  const hexOfActivity = ACTIVITY_B.replaceAll('-', '');
  assert.equal(hexOfActivity.length, 32);
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    // Same hex as an activity UUID, but no trace has it: unknown, never the activity.
    const failure = await failureOf(resolveId(index, hexOfActivity, PROJECT));
    assert.equal(failure.detail.code, 'id-unknown');
    assert.equal(
      described(await resolveId(index, TRACE_B, PROJECT)),
      `trace:${CAPSULE_B}:${TRACE_B}`,
    );
  } finally {
    await fixture.remove();
  }
  const withTrace = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [fixtureActivity(ACTIVITY_B, hexOfActivity)],
    },
  ]);
  try {
    const index = await ProjectIndex.load(withTrace.directory);
    assert.equal(
      described(await resolveId(index, hexOfActivity, PROJECT)),
      `trace:${CAPSULE_A}:${hexOfActivity}`,
    );
  } finally {
    await withTrace.remove();
  }
});

void test('a prefix matching several activities is ambiguous and lists every candidate', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    const failure = await failureOf(resolveId(index, '3f9a2c41', PROJECT));
    assert.equal(failure.detail.code, 'id-ambiguous');
    assert.equal(failure.detail.message, '3f9a2c41 matches 2 activities');
    assert.deepEqual(
      failure.detail.candidates
        .map(({ id, type, capsule, name }) => [id, type, capsule, name])
        .sort(),
      [
        [ACTIVITY_A, 'activity', CAPSULE_A, 'Create order'],
        [ACTIVITY_A2, 'activity', CAPSULE_A, null],
      ],
    );
    assert.deepEqual(failure.detail.next, ['use a longer prefix']);
  } finally {
    await fixture.remove();
  }
});

void test('an explicit context that does not contain the ID is a mismatch naming the owner', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    const scope = { kind: 'capsule', capsule: CAPSULE_B } as const;
    for (const input of [ACTIVITY_A, TRACE_A]) {
      const failure = await failureOf(resolveId(index, input, scope));
      assert.equal(failure.detail.code, 'id-capsule-mismatch');
      assert.equal(failure.detail.message, `${input} is not in capsule ${CAPSULE_B}`);
      assert.deepEqual(failure.detail.details, [`it belongs to capsule ${CAPSULE_A}`]);
      assert.deepEqual(failure.detail.next, [`blackbox show ${input} --capsule ${CAPSULE_A}`]);
      assert.deepEqual(
        failure.detail.candidates.map(({ capsule }) => capsule),
        [CAPSULE_A],
      );
    }
    // Narrowed to A, the ambiguous-looking long prefix is fine and in scope.
    const inScope = await resolveId(index, ACTIVITY_A, { kind: 'capsule', capsule: CAPSULE_A });
    assert.equal(described(inScope), `activity:${CAPSULE_A}:${ACTIVITY_A}`);
  } finally {
    await fixture.remove();
  }
});

void test('BLACKBOX_CAPSULE narrows ID search; the current-capsule file never does', async () => {
  const fixture = await twoCapsuleProject();
  try {
    await setCurrentCapsule(fixture.directory, CAPSULE_B);
    const fromFile = new InvocationContext(fixture.directory, {});
    const index = await fromFile.index();
    assert.equal(
      described(await resolveId(index, '3f9a2c41-7b', await fromFile.scope(null, 'observations'))),
      `activity:${CAPSULE_A}:${ACTIVITY_A}`,
    );
    const fromEnvironment = new InvocationContext(fixture.directory, {
      BLACKBOX_CAPSULE: CAPSULE_B,
    });
    const failure = await failureOf(
      resolveId(
        await fromEnvironment.index(),
        '3f9a2c41-7b',
        await fromEnvironment.scope(null, 'observations'),
      ),
    );
    assert.equal(failure.detail.code, 'id-capsule-mismatch');
  } finally {
    await fixture.remove();
  }
});

void test('a forced 8-character collision displays the shortest unique hyphenated prefix', async () => {
  assert.equal(shortActivityId(ACTIVITY_A, [ACTIVITY_A, ACTIVITY_A2]), '3f9a2c41-7b');
  assert.equal(shortActivityId(ACTIVITY_B, [ACTIVITY_A, ACTIVITY_A2, ACTIVITY_B]), '9b1e0d77');
  const fixture = await twoCapsuleProject();
  try {
    const index = await ProjectIndex.load(fixture.directory);
    const printed = shortActivityId(ACTIVITY_A2, [ACTIVITY_A, ACTIVITY_A2, ACTIVITY_B]);
    assert.equal(printed, '3f9a2c41-7c');
    assert.equal(
      described(await resolveId(index, printed, PROJECT)),
      `activity:${CAPSULE_A}:${ACTIVITY_A2}`,
    );
  } finally {
    await fixture.remove();
  }
});
