import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestCase, TestResult } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import BlackboxReporter from '../../reporter.js';
import { buildAttemptView, renderAttemptHtml, renderAttemptText } from './index.js';

const subscription = { id: 'subscription_alice', status: 'active' };

function attempt(lostPersistence: boolean, outputDir = ''): { test: TestCase; result: TestResult } {
  const effects = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    kind: 'stimulus-effects',
    executionId: 'execution-1',
    coverage: { coverage: 'unknown', closed: false },
    graph: { effects: [], relations: [] },
  }));
  const execution = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    kind: 'stimulus-executions',
    events: [
      { kind: 'begin', executionId: 'execution-1', title: 'When Alice subscribes',
        initial: { observers: [{ name: 'subscriptions', readers: [{ name: 'rows', value: [] }] }] } },
      { kind: 'precondition', executionId: 'execution-1', title: 'Given no subscriptions exist', status: 'passed' },
      { kind: 'action', executionId: 'execution-1', status: 'completed',
        captured: { output: { kind: 'response', status: 201, body: { subscription } }, effects: digestBytes(effects) } },
      { kind: 'final', executionId: 'execution-1',
        final: { observers: [{ name: 'subscriptions', readers: [{ name: 'rows', value: lostPersistence ? [] : [subscription] }] }] },
        diff: { observers: [{ name: 'subscriptions', diff: { rows: { added: lostPersistence ? [] : [subscription] } } }] } },
      { kind: 'claim', executionId: 'execution-1', title: 'Then an active subscription is returned', status: 'passed', evidence: [] },
      { kind: 'claim', executionId: 'execution-1', title: 'And exactly that subscription is retained',
        status: lostPersistence ? 'failed' : 'passed', evidence: [] },
    ],
    artifacts: [{ executionId: 'execution-1', output: { kind: 'response', status: 201, body: { subscription } }, effects: digestBytes(effects) }],
  }));
  const test = {
    id: 'subscription-contract', title: 'Scenario: Alice subscribes', expectedStatus: 'passed',
    titlePath: () => ['Rule: subscriptions are retained', 'Scenario: Alice subscribes'],
    location: { file: 'subscriptions.spec.ts', line: 12, column: 1 },
    parent: { project: () => ({ name: 'payment-system', outputDir }) },
  } as TestCase;
  const result = {
    status: lostPersistence ? 'failed' : 'passed', retry: 0, workerIndex: 1, parallelIndex: 0,
    duration: 123, attachments: [
      { name: 'blackbox-execution', contentType: 'application/json', body: execution },
      { name: 'effects.json', contentType: 'application/json', body: effects },
      { name: 'blackbox-capture-health', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'capture-health', status: 'captured',
          completeness: { closed: false, reasons: ['no-harness-completeness-attestation'] } })) },
    ],
    errors: lostPersistence ? [{ message: 'Expected one retained subscription' }] : [],
  } as TestResult;
  return { test, result };
}

it('shows the passing response, retained state, and open effects cut without inventing claim links', () => {
  const { test, result } = attempt(false);
  const view = buildAttemptView(test, result);
  expect(view.attempt.nativeStatus).toBe('passed');
  expect(view.verification.status, JSON.stringify(view.evidence.problems)).toBe('verified');
  expect(view.executions[0].output).toMatchObject({ status: 201 });
  expect(view.executions[0].diff).toMatchObject({ observers: [{ diff: { rows: { added: [subscription] } } }] });
  expect(view.executions[0].effects).toMatchObject({ status: 'captured', effects: [], coverage: { closed: false } });
  expect(view.executions[0].steps.filter(({ kind }) => kind === 'claim').every(({ evidence }) => evidence.length === 0)).toBe(true);
  expect(renderAttemptText(view)).toContain('coverage unknown, open');
  expect(renderAttemptHtml(view)).toContain('No effects were observed in this capture');
});

it('shows a failed persistence claim even when the captured HTTP response is 201', () => {
  const { test, result } = attempt(true);
  const view = buildAttemptView(test, result);
  expect(view.executions[0].output).toMatchObject({ status: 201 });
  expect(view.executions[0].diff).toMatchObject({ observers: [{ diff: { rows: { added: [] } } }] });
  expect(view.verification).toMatchObject({ status: 'failed', passed: 1, failed: 1 });
  expect(renderAttemptText(view)).toContain('failed: And exactly that subscription is retained');
  expect(renderAttemptHtml(view)).toContain('And exactly that subscription is retained');
});

it('escapes hostile evidence and never promotes missing effects to a successful view', () => {
  const { test, result } = attempt(false);
  const hostile = '<img src=x onerror=alert(1)>';
  result.attachments[0].body = Buffer.from(result.attachments[0].body!.toString('utf8').replaceAll('When Alice subscribes', hostile));
  result.attachments.splice(1, 1);
  const view = buildAttemptView(test, result);
  const html = renderAttemptHtml(view);
  expect(view.evidence.status).toBe('partial');
  expect(view.verification.status).toBe('unavailable');
  expect(view.executions[0].effects.status).toBe('unavailable');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain(hostile);
});

it('keeps a failed capture operation unsuccessful when the recorded claims passed', () => {
  const { test, result } = attempt(false);
  result.status = 'failed';
  result.attachments[2].body = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'capture-health', status: 'failed',
    observation: { message: 'collector stopped before final capture' },
  }));
  const view = buildAttemptView(test, result);
  expect(view.attempt.nativeStatus).toBe('failed');
  expect(view.verification).toMatchObject({ status: 'unavailable', passed: 2 });
  expect(view.evidence).toMatchObject({ status: 'partial', captureHealth: { status: 'failed' } });
  expect(renderAttemptHtml(view)).toContain('collector stopped before final capture');
});

it('writes one private HTML and JSON report and attaches both to the native result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-attempt-view-'));
  try {
    const { test, result } = attempt(false, directory);
    const reporter = new BlackboxReporter();
    reporter.onTestEnd(test, result);
    expect(result.attachments.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'blackbox-report-json', 'blackbox-report-html',
    ]));
    expect(await reporter.onEnd()).toBeUndefined();
    const html = result.attachments.find(({ name }) => name === 'blackbox-report-html');
    const json = result.attachments.find(({ name }) => name === 'blackbox-report-json');
    if (html === undefined || html.body === undefined || json === undefined || json.body === undefined) {
      throw new Error('Blackbox report attachments are missing');
    }
    expect(html.body.toString('utf8')).toContain('Download adapted JSON');
    expect(JSON.parse(json.body.toString('utf8'))).toMatchObject({ verification: { status: 'verified' } });
    const reports = await readdir(join(directory, 'blackbox-report'));
    expect(reports).toHaveLength(1);
    const reportDir = join(directory, 'blackbox-report', reports[0], 'retry-0-worker-1');
    expect(await readFile(join(reportDir, 'report.html'), 'utf8')).toBe(html.body.toString('utf8'));
    expect(await readFile(join(reportDir, 'report.json'), 'utf8')).toBe(json.body.toString('utf8'));
    expect((await stat(join(reportDir, 'report.json'))).mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('fails the run when a report cannot be persisted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-report-failure-'));
  try {
    const occupied = join(directory, 'occupied');
    await writeFile(occupied, 'not a directory');
    const { test, result } = attempt(false, occupied);
    const reporter = new BlackboxReporter();
    reporter.onTestEnd(test, result);
    expect(await reporter.onEnd()).toEqual({ status: 'failed' });
    expect(result.attachments.map(({ name }) => name)).toContain('blackbox-report-json');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps retries of the same accepted scenario in separate report directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-report-retries-'));
  try {
    const first = attempt(true, directory);
    const repaired = attempt(false, directory);
    repaired.result.retry = 1;
    const reporter = new BlackboxReporter();
    reporter.onTestEnd(first.test, first.result);
    reporter.onTestEnd(repaired.test, repaired.result);
    expect(await reporter.onEnd()).toBeUndefined();
    const [scenario] = await readdir(join(directory, 'blackbox-report'));
    const attempts = await readdir(join(directory, 'blackbox-report', scenario));
    expect(attempts).toEqual(['retry-0-worker-1', 'retry-1-worker-1']);
    const failed = JSON.parse(await readFile(join(directory, 'blackbox-report', scenario,
      attempts[0], 'report.json'), 'utf8')) as { verification: { status: string } };
    const passed = JSON.parse(await readFile(join(directory, 'blackbox-report', scenario,
      attempts[1], 'report.json'), 'utf8')) as { verification: { status: string } };
    expect([failed.verification.status, passed.verification.status]).toEqual(['failed', 'verified']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
