import { expect, it } from 'vitest';
import { join } from 'node:path';
import { BehaviorHistory } from '../../history/history.js';
import { ingestPlaywrightResults } from '../../history/ingestion/playwright-results.js';
import { digestBytes } from '../../envelope/index.js';
import { discovered, runAssertions } from '../../testing/assertion-accounting/native-runner.fixture.js';

it('executes lifecycle claims under the native Playwright runner', async () => {
  const run = await runAssertions('stimulus.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'captures exact initial values and binds sequential verification',
    'precondition failures and overlap block the action',
    'capture and action failures preserve only available evidence',
    'foreign handles and invalid runtime titles are rejected',
    'reviewed normalized final state uses native snapshots',
    'unavailable effect coverage records an inconclusive claim',
    'interrupted actions retain initial evidence without a final checkpoint',
    'a caught final capture failure remains visible at fixture teardown',
    'mixed failed and inconclusive assertions remain failed',
    'concurrent claims remain attributed to their own executions',
    'retains an execution verification handle for ownership checking',
    'a foreign test cannot use an active or expired verification handle',
  ]);
  for (const spec of specs) {
    expect(spec.tests).toHaveLength(1);
    expect(spec.tests[0].results).toHaveLength(1);
    expect(spec.tests[0].results[0].status).toBe('passed');
  }
  expect(run.report.stats).toMatchObject({ expected: 12, unexpected: 0, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'stimulus-events', value: ['begin', 'precondition', 'action', 'final', 'claim', 'begin', 'action', 'final'] });
}, 60_000);

function assertResponseEvidence(specs: ReturnType<typeof discovered>): void {
  const responseSpec = specs.find(({ title }) => title === 'captures ordinary responses and rejects oversized output');
  if (responseSpec === undefined) { throw new Error('missing response test'); }
  const responseAttachment = responseSpec.tests[0].results[0].attachments.find(({ name }) => name === 'blackbox-execution');
  if (responseAttachment === undefined || responseAttachment.body === undefined) { throw new Error('missing response evidence'); }
  const responseEvidence = JSON.parse(Buffer.from(responseAttachment.body, 'base64').toString('utf8')) as { events: unknown[] };
  expect(responseEvidence.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'action', captured: expect.objectContaining({ output: expect.objectContaining({ body: 'chunked' }) }) }),
    expect.objectContaining({ kind: 'action', captured: expect.objectContaining({ output: expect.objectContaining({ body: { value: 'compressed', password: '[REDACTED]' } }) }) }),
    expect.objectContaining({ kind: 'action', captured: expect.objectContaining({ output: expect.objectContaining({ body: 'no-length' }) }) }),
  ]));
}

function assertPartialHealth(specs: ReturnType<typeof discovered>): void {
  const partial = specs.find(({ title }) => title === 'bounds the supplemental capture while retaining nine stimuli');
  if (partial === undefined) { throw new Error('missing bounded aggregate test'); }
  const health = partial.tests[0].results[0].attachments.find(({ name }) => name === 'blackbox-capture-health');
  if (health === undefined || health.body === undefined) { throw new Error('missing capture health'); }
  expect(JSON.parse(Buffer.from(health.body, 'base64').toString('utf8'))).toMatchObject({
    status: 'captured', observation: { diagnostics: expect.arrayContaining(['final-aggregate-omitted:1']) },
    completeness: { closed: false, reasons: expect.arrayContaining(['final-aggregate-omitted:1']) },
  });
}

function assertReceiptEvidence(successfulDetails: Awaited<ReturnType<BehaviorHistory['execution']>>[], rows: Awaited<ReturnType<BehaviorHistory['index']>>['executions']): void {
  const receiptFailure = successfulDetails.find((item) => item !== null && item.envelope.provenance.test.titlePath.includes('receipt attachment failure preserves cleanup and evidence'));
  if (receiptFailure === undefined || receiptFailure === null) { throw new Error('missing receipt failure execution'); }
  expect(rows.find(({ envelopeId }) => envelopeId === receiptFailure.envelope.digest)).toMatchObject({ testStatus: 'failed', finalStatus: 'failed', captureTestStatus: 'passed', statusDiscrepancy: true });
  expect(receiptFailure.evidence).toContainEqual(expect.objectContaining({ kind: 'execution-evidence', status: 'stored' }));
}

function assertExecutionArtifacts(specs: ReturnType<typeof discovered>, detail: NonNullable<Awaited<ReturnType<BehaviorHistory['execution']>>>): void {
  const native = specs.find(({ title }) => title === 'injects the native stimulus fixture and verifies its captured state');
  if (native === undefined) { throw new Error('native execution was not discovered'); }
  const attachment = native.tests[0].results[0].attachments.find(({ name }) => name === 'blackbox-execution');
  if (attachment === undefined || attachment.body === undefined) { throw new Error('execution attachment missing'); }
  const body = Buffer.from(attachment.body, 'base64').toString('utf8');
  expect(body).toContain('pi_created');
  expect(body).not.toContain('synthetic-password');
  const effects = native.tests[0].results[0].attachments.find(({ name }) => name === 'effects.json');
  if (effects === undefined || effects.body === undefined) { throw new Error('effects attachment missing'); }
  expect(JSON.parse(Buffer.from(effects.body, 'base64').toString('utf8'))).toMatchObject({
    kind: 'stimulus-effects', graph: { effects: [expect.objectContaining({ kind: 'http', operation: 'POST', target: '/payments', attributes: {} })] },
  });
  const emission = native.tests[0].results[0].attachments.find(({ name }) => name === 'blackbox-emissions');
  if (emission === undefined || emission.body === undefined) { throw new Error('emission attachment missing'); }
  const emissionId = digestBytes(Buffer.from(emission.body, 'base64'));
  const emissionCut = (JSON.parse(Buffer.from(emission.body, 'base64').toString('utf8')) as { captureReference: string }).captureReference;
  const emissions = native.tests[0].results[0].attachments.filter(({ name }) => name === 'blackbox-emissions');
  if (emissions[1].body === undefined) { throw new Error('missing concurrent emission'); }
  const concurrentEmissionId = digestBytes(Buffer.from(emissions[1].body, 'base64'));
  const concurrentCut = (JSON.parse(Buffer.from(emissions[1].body, 'base64').toString('utf8')) as { captureReference: string }).captureReference;
  expect(emissionCut).not.toBe(concurrentCut);
  for (const id of [emissionCut, concurrentCut]) {
    expect(detail.evidence).toContainEqual(expect.objectContaining({ id, kind: 'stimulus-effects', status: 'stored' }));
  }
  expect(detail.evidence).toContainEqual(expect.objectContaining({ id: concurrentEmissionId, kind: 'assertion-evidence', status: 'stored' }));
  expect(detail.evidence).toContainEqual(expect.objectContaining({ id: emissionId, kind: 'assertion-evidence', status: 'stored' }));
  expect(JSON.parse(body)).toMatchObject({ kind: 'stimulus-executions', events: [
    { kind: 'begin', initial: { observers: [{ name: 'counter', readers: [{ name: 'value', value: 0 }] }] } },
    { kind: 'precondition', status: 'passed' },
    { kind: 'action', status: 'completed', captured: { output: { kind: 'response', status: 201, body: { id: 'pi_created', password: '[REDACTED]' } } } },
    { kind: 'final', diff: { observers: [{ name: 'counter', status: 'captured', diff: { value: { before: 0, after: 1, changed: true } } }] } },
    { kind: 'claim', status: 'passed' },
    { kind: 'claim', status: 'passed', evidence: [emissionCut, emissionId] },
    { kind: 'claim', status: 'passed', snapshots: [{ matcher: 'toMatchSnapshot', status: 'passed' }] },
    { kind: 'claim', title: 'And the concurrent emission is observed', status: 'passed', evidence: [concurrentCut, concurrentEmissionId] },
    { kind: 'claim', title: 'And the delayed claim passes', status: 'passed', evidence: [] },
  ] });
}

it('retains bounded execution evidence and capture failures', async () => {
  const run = await runAssertions('stimulus-evidence.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual([
    'injects the native stimulus fixture and verifies its captured state',
    'unasserted output capture failure still fails the attempt',
    'unwritable evidence fails the attempt',
    'lost final collector state fails even without a final snapshot',
    'receipt attachment failure preserves cleanup and evidence',
    'captures ordinary responses and rejects oversized output',
    'bounds the supplemental capture while retaining nine stimuli',
  ]);
  expect(specs.map((spec) => spec.tests[0].results[0].status)).toEqual(['passed', 'failed', 'failed', 'failed', 'failed', 'failed', 'passed']);
  expect(run.report.stats).toMatchObject({ expected: 7, unexpected: 0, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'unasserted-capture-caught', value: true });
  expect(run.events).toContainEqual({ kind: 'persistence-failure-caught', value: true });
  expect(run.events).toContainEqual({ kind: 'final-capture-body-completed', value: true });
  expect(run.events).toContainEqual({ kind: 'receipt-attachment-rejected', value: true });
  expect(run.events).toContainEqual({ kind: 'receipt-action-completed', value: true });
  expect(run.events).toContainEqual({ kind: 'ordinary-responses-captured', value: true });
  expect(run.events).toContainEqual({ kind: 'oversized-response-caught', value: true });
  expect(run.events).toContainEqual({ kind: 'completed-nine-stimuli', value: true });
  expect(run.events.filter(({ kind }) => kind === 'fixture-collector-closed')).toHaveLength(7);
  expect(run.events).toContainEqual({ kind: 'retained-executions', value: { attempts: 7, files: 32, blocked: 1, leaked: false } });
  assertResponseEvidence(specs);
  assertPartialHealth(specs);
  const history = await BehaviorHistory.open(join(run.directory, 'history'));
  const ingestion = await ingestPlaywrightResults(history, join(run.directory, 'results.json'));
  expect(ingestion).toMatchObject({ envelopes: 7, rejected: [] });
  const index = await history.index();
  expect(index.executions).toHaveLength(7);
  const successful = index.executions.filter(({ testStatus }) => testStatus === 'passed');
  expect(successful).toHaveLength(2);
  const successfulDetails = await Promise.all(successful.map(({ envelopeId }) => history.execution(envelopeId)));
  const detail = successfulDetails.find((item) => item !== null && item.envelope.provenance.test.titlePath.includes('injects the native stimulus fixture and verifies its captured state'));
  if (detail === null || detail === undefined) { throw new Error('missing retained execution'); }
  expect(detail.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'execution-evidence', status: 'stored' }),
    expect.objectContaining({ kind: 'stimulus-effects', status: 'stored' }),
    expect.objectContaining({ kind: 'capture-health', status: 'stored' }),
  ]));
  const failed = index.executions.filter(({ testStatus }) => testStatus === 'failed');
  expect(failed).toHaveLength(5);
  const failedDetails = await Promise.all(failed.map(({ envelopeId }) => history.execution(envelopeId)));
  assertReceiptEvidence(failedDetails, index.executions);
  const failedDetail = failedDetails.find((item) => item !== null && item.evidence.some(({ kind }) => kind === 'execution-evidence'));
  if (failedDetail === null || failedDetail === undefined) { throw new Error('missing failed execution evidence'); }
  expect(failedDetail.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'execution-evidence', status: 'stored' }),
    expect.objectContaining({ kind: 'stimulus-effects', status: 'stored' }),
  ]));
  assertExecutionArtifacts(specs, detail);
}, 60_000);

it('blocks the action for a native soft failure while the native test remains failed', async () => {
  const run = await runAssertions('stimulus-soft.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['soft failing precondition never invokes action', 'soft failure mixed with unavailable evidence remains failed']);
  for (const spec of specs) { expect(spec.tests[0].results[0].status).toBe('failed'); }
  expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 2, skipped: 0, flaky: 0 });
  expect(run.events).toContainEqual({ kind: 'soft-precondition-blocked', value: 0 });
  expect(run.events).toContainEqual({ kind: 'soft-mixed-failed', value: true });
}, 60_000);

it('records real native timeout as interrupted and retains only initial evidence', async () => {
  const run = await runAssertions('stimulus-timeout.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['native timeout interrupts an action without inventing final state']);
  const result = specs[0].tests[0].results[0];
  expect(result.status).toBe('timedOut');
  const attachment = result.attachments.find(({ name }) => name === 'interrupted-lifecycle');
  if (attachment === undefined || attachment.body === undefined) { throw new Error('Missing interrupted lifecycle evidence'); }
  expect(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))).toEqual([
    { kind: 'begin' }, { kind: 'action', status: 'interrupted' },
  ]);
}, 60_000);

it('retains independent executions of the same contract across reruns', async () => {
  const title = 'injects the native stimulus fixture and verifies its captured state';
  const first = await runAssertions('stimulus-evidence.spec.ts', [title]);
  const second = await runAssertions('stimulus-evidence.spec.ts', [title]);
  expect(first.exitCode).toBe(0);
  expect(second.exitCode).toBe(0);
  const history = await BehaviorHistory.open(join(first.directory, 'rerun-history'));
  await ingestPlaywrightResults(history, join(first.directory, 'results.json'));
  await ingestPlaywrightResults(history, join(second.directory, 'results.json'));
  const executions = (await history.index()).executions;
  expect(executions).toHaveLength(2);
  expect(executions[0].behaviorId).toBe(executions[1].behaviorId);
  expect(executions[0].attemptId).not.toBe(executions[1].attemptId);
  const behavior = await history.behaviorHistory(executions[0].behaviorId, { followAliases: false });
  expect(behavior).toHaveLength(2);
  for (const execution of executions) {
    const detail = await history.execution(execution.envelopeId);
    if (detail === null) { throw new Error('missing rerun execution'); }
    expect(detail.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'execution-evidence', status: 'stored' }),
    ]));
  }
}, 60_000);

it('retains interrupted execution evidence after a native timeout', async () => {
  const run = await runAssertions('durable-timeout.spec.ts');
  expect(run.exitCode).toBe(1);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['timeout retains interrupted execution']);
  expect(specs[0].tests[0].results[0].status).toBe('timedOut');
  expect(run.events).toContainEqual({ kind: 'timeout-action-started', value: true });
  expect(run.events).toContainEqual({ kind: 'timeout-collector-closed', value: 'collector-stopped' });
  expect(run.events).toContainEqual({ kind: 'timeout-retained-attempts', value: 1 });
  const attachment = specs[0].tests[0].results[0].attachments.find(({ name }) => name === 'blackbox-execution');
  if (attachment === undefined || attachment.body === undefined) { throw new Error('missing interrupted execution'); }
  expect(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))).toMatchObject({ events: [
    { kind: 'begin' }, { kind: 'action', status: 'interrupted' },
  ] });
  const history = await BehaviorHistory.open(join(run.directory, 'timeout-history'));
  await ingestPlaywrightResults(history, join(run.directory, 'results.json'));
  expect((await history.index()).executions[0]).toMatchObject({ testStatus: 'timedOut', finalStatus: 'timedOut' });
}, 60_000);

it('uses one frozen observer set and the same precondition checkpoint', async () => {
  const run = await runAssertions('frozen-selection.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(0);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['frozen selection excludes observers registered while the action runs']);
  expect(specs[0].tests[0].results[0].status).toBe('passed');
  expect(run.report.stats).toMatchObject({ expected: 1, unexpected: 0, skipped: 0, flaky: 0 });
}, 60_000);
