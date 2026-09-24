import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapsuleAcquisitionObservation } from '@suites/blackbox-capsule-internal';
import { createCapsuleProgressRenderer } from './capsule-progress.js';

const base = {
  sessionId: 'quiet-river-ada',
  sequence: 1,
  at: 'now',
  stage: 'acquisition',
} as const;
const observation = {
  kind: 'service-state',
  participant: 'postgres',
  container: {
    service: 'db',
    containerId: 'internal-id',
    containerName: 'internal-db',
    state: 'running',
    health: 'starting',
    termination: { kind: 'none' },
  },
} satisfies CapsuleAcquisitionObservation;

void test('keeps early service state visible with names and distinguishes Docker health from application readiness', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({
    presentation: 'interactive',
    color: false,
    write: (text) => output.push(text),
  });
  try {
    renderer.sink({ ...base, kind: 'compose-configured', projectName: 'bb-internal-uuid' });
    renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'bb-internal-uuid' });
    renderer.sink({ ...base, kind: 'acquisition-observation', observation });
    renderer.sink({
      ...base,
      kind: 'acquisition-observation',
      observation: { kind: 'waiting', elapsedMs: 5000 },
    });
    renderer.sink({
      ...base,
      kind: 'container-acquired',
      participant: 'postgres',
      service: 'db',
      containerId: 'internal-id',
      containerName: 'internal-db',
      networkNames: [],
    });
    const text = output.join('');
    assert.match(text, /Acquiring capsule/u);
    assert.match(text, /postgres — running; Docker health: starting/u);
    assert.match(text, /elapsed/u);
    assert.doesNotMatch(text, /internal|application ready|Acquisition complete/u);
    renderer.sink({
      ...base,
      kind: 'readiness-started',
      stage: 'readiness',
      url: 'http://localhost/health',
      timeoutMs: 1000,
    });
    assert.match(output.join(''), /Acquisition — Testcontainers checks passed/u);
    assert.match(output.join(''), /Application readiness — checking/u);
  } finally {
    renderer.finish();
  }
});

void test('failed acquisition never gets a success check when the error is attributed to persistence', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({
    presentation: 'interactive',
    color: false,
    write: (text) => output.push(text),
  });
  renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'owned' });
  renderer.sink({
    ...base,
    kind: 'capsule-start-failed',
    stage: 'persistence',
    cause: { name: 'Error', message: 'disk full' },
  });
  renderer.finish();
  assert.match(output.join(''), /✗ Capsule start failed — persistence/u);
  assert.match(output.join(''), /disk full/u);
  assert.doesNotMatch(output.join(''), /✓/u);
});

void test('plain progress reports exit code, observation outages and recovery without control codes', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({
    presentation: 'plain',
    color: true,
    write: (text) => output.push(text),
  });
  const observations = [
    {
      ...observation,
      container: {
        ...observation.container,
        state: 'exited',
        termination: { kind: 'exited', exitCode: 7 },
      },
    },
    { kind: 'observation-status', status: 'unavailable' },
    { kind: 'observation-status', status: 'available' },
    { kind: 'resource-discovered', resource: { kind: 'network', name: 'owned-net' } },
    { kind: 'waiting', elapsedMs: 5000 },
  ] satisfies CapsuleAcquisitionObservation[];
  for (const value of observations) {
    renderer.sink({ ...base, kind: 'acquisition-observation', observation: value });
  }
  for (const line of output) {
    assert.match(line, /^ {2}\[1\] /u);
  }
  assert.match(output.join(''), /container exited.*exit 7/u);
  assert.match(output.join(''), /progress unavailable; startup continues/u);
  assert.match(output.join(''), /observation resumed/u);
  assert.match(output.join(''), /owned-net/u);
  assert.match(output.join(''), /5s elapsed/u);
  assert.equal(output.join('').includes('\r') || output.join('').includes('\u001b'), false);
});

void test('interactive substeps mark observed unhealthy and terminated containers as failures', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({
    presentation: 'interactive',
    color: false,
    write: (text) => output.push(text),
  });
  try {
    for (const state of ['created', 'running', 'dead'] as const) {
      renderer.sink({
        ...base,
        kind: 'acquisition-observation',
        observation: {
          ...observation,
          container: {
            ...observation.container,
            state,
            health: state === 'running' ? 'unhealthy' : 'not-configured',
            termination: state === 'dead' ? { kind: 'exited', exitCode: 137 } : { kind: 'none' },
          },
        },
      });
    }
    assert.match(output.join(''), /[⠋⠙⠹⠸] postgres — created/u);
    assert.match(output.join(''), /✗ postgres — running; Docker health: unhealthy/u);
    assert.match(output.join(''), /✗ postgres — dead; exit 137/u);
    assert.doesNotMatch(output.join(''), /✓/u);
  } finally {
    renderer.finish();
  }
});
