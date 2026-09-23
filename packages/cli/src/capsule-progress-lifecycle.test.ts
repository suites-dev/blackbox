import assert from 'node:assert/strict';
import test from 'node:test';

import type { CapsuleProgressEvent } from '@suites/blackbox-capsule-internal';

import { createCapsuleProgressRenderer } from './capsule-progress.js';

const base = { sessionId: 'quiet-river-ada', sequence: 1, at: '2026-01-01', stage: 'acquisition' } as const;

void test('explicit finish stops the spinner after an interrupted startup without claiming readiness', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'interactive', color: false, write: (text) => output.push(text) });
  renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'owned-compose' });
  context.mock.timers.tick(400);
  assert.ok(new Set(output).size > 1, 'timer must advance the glyph without new lifecycle events');
  renderer.finish();
  const finishedLength = output.length;
  context.mock.timers.tick(1000);
  assert.equal(output.length, finishedLength);
  assert.doesNotMatch(output.join(''), /✓|Capsule ready/u);
  assert.doesNotMatch(output.join(''), new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'u'));
});

void test('failure stops future frames and uses the failed stage marker', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'interactive', color: true, write: (text) => output.push(text) });
  renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'owned-compose' });
  context.mock.timers.tick(100);
  renderer.sink({ ...base, sequence: 2, kind: 'capsule-start-failed', cause: { name: 'Timeout', message: 'container never became ready' } });
  const failedLength = output.length;
  context.mock.timers.tick(1000);
  renderer.finish();
  assert.equal(output.length, failedLength);
  assert.match(output.join(''), /✗.*acquisition/u);
  assert.match(output.join(''), /container never became ready/u);
  assert.doesNotMatch(output.join(''), /✓/u);
});

void test('plain mode retains named resources, endpoints, and readiness milestones without terminal control codes', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'plain', color: true, write: (text) => output.push(text) });
  const events = [
    { ...base, kind: 'manager-spawned', managerPid: 123 },
    { ...base, kind: 'manager-ready', managerPid: 123 },
    { ...base, kind: 'catalog-selected', system: 'orders', configFile: '/private/config.yaml' },
    { ...base, kind: 'catalog-resolved', system: 'orders', projectDirectory: '/private/project', composeFiles: ['compose.yaml'], services: ['api', 'db'] },
    { ...base, kind: 'compose-configured', projectName: 'owned-compose' },
    { ...base, kind: 'container-acquired', participant: 'postgres', service: 'db', containerName: 'owned-db-1', containerId: 'container-123', networkNames: ['owned-net'] },
    { ...base, kind: 'endpoint-mapped', endpoint: { url: 'http://localhost:1234', host: 'localhost', port: 1234, protocol: 'http' } },
    { ...base, kind: 'resource-owned', resource: { kind: 'network', name: 'owned-net' } },
    { ...base, kind: 'resource-owned', resource: { kind: 'volume', name: 'owned-volume' } },
    { ...base, kind: 'readiness-started', url: 'http://localhost:1234/health', timeoutMs: 3000 },
    { ...base, kind: 'readiness-succeeded', url: 'http://localhost:1234/health', durationMs: 750 },
  ] satisfies CapsuleProgressEvent[];
  for (const event of events) { renderer.sink(event); }
  renderer.finish();
  assert.equal(output.length, events.length);
  for (const line of output) { assert.ok(line.endsWith('\n')); assert.equal(line.includes('\r') || line.includes('\u001b'), false); }
  const text = output.join('');
  for (const required of ['api, db', 'owned-compose', 'postgres', 'owned-db-1', 'container-123', 'owned-net', 'owned-volume', 'http://localhost:1234', '750ms']) {
    assert.ok(text.includes(required), `missing ${required}`);
  }
  assert.doesNotMatch(text, /\/private/u);
});

void test('silent mode suppresses failures and resource updates as well as the final event', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'silent', color: true, write: (text) => output.push(text) });
  renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'owned-compose' });
  renderer.sink({ ...base, kind: 'capsule-start-failed', cause: { name: 'Error', message: 'failed' } });
  context.mock.timers.tick(1000);
  renderer.finish();
  assert.deepEqual(output, []);
});
