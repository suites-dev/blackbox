import { expect, it } from 'vitest';
import { discovered, runAssertions } from '../../../testing/assertion-accounting/native-runner.fixture.js';
import { checkDelayedHistory, checkIsolationHistory, reopenHistory, type DelayedProof, type IsolationProof } from '../../../testing/assertion-accounting/lazy/history.fixture.js';

it('waits for real delayed exports and reopens exact immutable assertion cuts', async () => {
  const run = await runAssertions('lazy-effects.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'lazy effects wait for delayed OTLP and retain the terminal cut',
    'later stimulus telemetry cannot satisfy an earlier lazy handle',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 2, unexpected: 0, skipped: 0, flaky: 0 });
  const delayedEvent = run.events.find(({ kind }) => kind === 'lazy-delayed-proof');
  const isolationEvent = run.events.find(({ kind }) => kind === 'lazy-isolation-proof');
  if (delayedEvent === undefined || isolationEvent === undefined) { throw new Error('Missing observed lazy fixture receipts'); }
  const delayed = delayedEvent.value as DelayedProof;
  const isolation = isolationEvent.value as IsolationProof;
  expect(delayed).toMatchObject({ status: 201, exported: 1 });
  expect(delayed.accounting).toEqual({ total: 1, passed: 1, failed: 0, pending: 0, unconsumed: 0 });
  expect(delayed.matcherCaptureIds.length).toBeGreaterThan(1);
  expect(isolation).toMatchObject({ exported: 1, foreignReads: 0 });
  expect(isolation.traceIds).toHaveLength(2);
  expect(new Set(isolation.traceIds).size).toBe(2);
  expect(delayed.executionId).not.toBe(isolation.executionId);
  const cleanups = run.events.filter(({ kind }) => kind === 'lazy-cleanup').map(({ value }) => value);
  expect(cleanups).toEqual([
    { executionId: delayed.executionId, serverListening: false, collector: 'collector-stopped', requests: 1, exported: 1 },
    { executionId: isolation.executionId, serverListening: false, collector: 'collector-stopped', requests: 2, exported: 1 },
  ]);
  const history = await reopenHistory(run.directory, 2);
  await checkDelayedHistory(history, specs[0], delayed);
  await checkIsolationHistory(history, specs[1], isolation);
}, 60_000);

it('cancels a native lazy claim without retaining a fabricated terminal cut', async () => {
  const run = await runAssertions('lazy-cancellation.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['native timeout cancels lazy reads without a terminal assertion artifact']);
  const result = specs[0].tests[0].results[0];
  expect(result.status).toBe('timedOut');
  expect(run.events).toContainEqual({ kind: 'lazy-cancellation-started', value: expect.objectContaining({ emissions: 0 }) });
  expect(run.events.filter(({ kind }) => kind === 'lazy-cleanup').map(({ value }) => value)).toEqual([
    expect.objectContaining({ serverListening: false, collector: 'collector-stopped', exported: 0 }),
  ]);
  expect(result.attachments.filter(({ name }) => name === 'blackbox-emissions')).toEqual([]);
  expect(result.attachments.filter(({ name }) => name === 'effects.json')).toHaveLength(1);
  const execution = result.attachments.find(({ name }) => name === 'blackbox-execution');
  if (execution === undefined || execution.body === undefined) { throw new Error('Missing interrupted execution evidence'); }
  expect(JSON.parse(Buffer.from(execution.body, 'base64').toString('utf8'))).toMatchObject({ events: expect.arrayContaining([
    expect.objectContaining({ kind: 'claim', title: 'Then an unfinished lazy claim is interrupted', status: 'interrupted', evidence: [] }),
  ]) });
  const history = await reopenHistory(run.directory, 1);
  const row = (await history.index()).executions[0];
  expect(row).toMatchObject({ testStatus: 'timedOut', finalStatus: 'timedOut' });
}, 60_000);

it('retains a caught lazy persistence failure while final collector capture stays healthy', async () => {
  const run = await runAssertions('lazy-persistence.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['caught terminal capture attachment failure still fails the attempt']);
  expect(specs[0].tests).toHaveLength(1);
  expect(specs[0].tests[0].results).toHaveLength(1);
  const result = specs[0].tests[0].results[0];
  expect(result.status).toBe('failed');
  expect(result.errors.map(({ message }) => message).join('\n')).toContain('Blackbox execution capture failed');
  expect(run.events).toContainEqual({ kind: 'lazy-persistence-body', value: expect.objectContaining({ initialAttachments: 1, rejections: 1, exported: 1 }) });
  expect(run.events.filter(({ kind }) => kind === 'lazy-cleanup').map(({ value }) => value)).toEqual([
    expect.objectContaining({ serverListening: false, collector: 'collector-stopped', requests: 1, exported: 1 }),
  ]);
  expect(result.attachments.filter(({ name }) => name === 'effects.json')).toHaveLength(1);
  expect(result.attachments.filter(({ name }) => name === 'blackbox-emissions')).toEqual([]);
  const health = result.attachments.find(({ name }) => name === 'blackbox-capture-health');
  if (health === undefined || health.body === undefined) { throw new Error('Missing final collector health'); }
  expect(JSON.parse(Buffer.from(health.body, 'base64').toString('utf8'))).toMatchObject({ status: 'captured',
    collector: { state: 'found', receiver: 'stopped', shutdown: 'complete', acceptedRequests: 1, acceptedSpans: 1, failure: null },
    observation: { state: 'admitted', payloadCount: 1, missingActivityTraces: [] },
  });
  const history = await reopenHistory(run.directory, 1);
  expect((await history.index()).executions[0]).toMatchObject({ testStatus: 'failed', finalStatus: 'failed' });
}, 60_000);
