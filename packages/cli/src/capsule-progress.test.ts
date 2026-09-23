import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapsuleProgressRenderer } from './capsule-progress.js';

void test('plain progress is newline-delimited and redacts sensitive roots', () => {
  const lines: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'plain', color: true, write: (text) => lines.push(text) });
  renderer.sink({ kind: 'session-admitted', sessionId: 'flying-suite-jacob', sequence: 1, at: 'now', stage: 'admission', system: 'orders', artifactRoot: '/private/secret/run', environmentKeys: ['TOKEN'] });
  renderer.sink({ kind: 'capsule-ready', sessionId: 'flying-suite-jacob', sequence: 2, at: 'now', stage: 'ready', durationMs: 42 });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /TOKEN/u);
  assert.doesNotMatch(lines[0], /private\/secret/u);
  assert.equal(lines[0].includes('\u001b['), false);
});

void test('silent progress writes nothing', () => {
  const lines: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'silent', color: true, write: (text) => lines.push(text) });
  renderer.sink({ kind: 'capsule-ready', sessionId: 's', sequence: 1, at: 'now', stage: 'ready', durationMs: 1 });
  assert.deepEqual(lines, []);
});

void test('interactive progress starts, updates, and completes its loader', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'interactive', color: true, write: (text) => output.push(text) });
  renderer.sink({ kind: 'acquisition-started', sessionId: 's', sequence: 1, at: 'now', stage: 'acquisition', projectName: 'orders' });
  renderer.sink({ kind: 'capsule-ready', sessionId: 's', sequence: 2, at: 'now', stage: 'ready', durationMs: 8 });
  assert.equal(output[0].includes('\u001b[36m'), true);
  assert.match(output[0], /Acquiring capsule/u);
  assert.match(output[1], /✓.*Capsule ready/u);
  assert.equal(output.at(-1), '\r\n');
});

void test('interactive failure completes the loader with a failure marker', () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'interactive', color: false, write: (text) => output.push(text) });
  renderer.sink({ kind: 'capsule-start-failed', sessionId: 's', sequence: 1, at: 'now', stage: 'readiness', cause: { name: 'Timeout', message: 'not ready' } });
  assert.match(output[0], /✗/u);
  assert.equal(output[0].includes('\u001b[36m'), false);
});

void test('interactive spinner advances while an event is pending and stops on completion', async () => {
  const output: string[] = [];
  const renderer = createCapsuleProgressRenderer({ presentation: 'interactive', color: false, write: (text) => output.push(text) });
  renderer.sink({ kind: 'acquisition-started', sessionId: 's', sequence: 1, at: 'now', stage: 'acquisition', projectName: 'orders' });
  await new Promise((resolve) => setTimeout(resolve, 230));
  const beforeCompletion = output.length;
  renderer.sink({ kind: 'capsule-ready', sessionId: 's', sequence: 2, at: 'now', stage: 'ready', durationMs: 8 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(beforeCompletion >= 2);
  assert.equal(output.length, beforeCompletion + 2);
});
