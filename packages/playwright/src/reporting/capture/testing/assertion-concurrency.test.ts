import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, it } from 'vitest';

import { compileEffectContract } from '../../../effects/contract.js';
import type { EffectAssertionReport } from '../../../effects/runtime.js';
import { digestBytes, digestOf } from '../../../envelope/index.js';
import { inputFixture } from '../../../envelope/testing/envelope.fixture.js';
import { verifyEnvelope } from '../../../envelope/verify.js';
import { BehaviorHistory } from '../../../history/history.js';
import { ingestPlaywrightResults } from '../../../history/ingestion/playwright-results.js';
import type { BlackboxSandbox, BlackboxTelemetry } from '../../../types.js';
import { AttemptReport } from '../../attempt.js';
import { buildAttemptEnvelope } from '../envelope.js';

interface Pending {
  readonly name: string;
  readonly body: string;
  resolve(): void;
  reject(error: Error): void;
}

function deferredAttachments() {
  const pending: Pending[] = [];
  const testInfo = {
    attach: (name: string, { body }: { body: string }) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ name, body, resolve, reject });
      }),
  } as TestInfo;
  return { pending, report: new AttemptReport(testInfo) };
}

const assertion = (route: string): EffectAssertionReport => ({
  contract: compileEffectContract((fx) => [fx.exists(fx.http({ route }))]),
  evaluation: { kind: 'satisfied' },
  evidence: null,
  negated: false,
});
const sequenceOf = (body: string): number =>
  (
    JSON.parse(body) as {
      assertion: { sequence: number };
    }
  ).assertion.sequence;

function testInfoDouble(fields: Partial<TestInfo>): TestInfo {
  return fields as TestInfo;
}

async function checkEnvelope(report: AttemptReport, accepted: readonly Pending[]) {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-assertion-sequences-'));
  try {
    const base = inputFixture();
    const testInfo = testInfoDouble({
      outputDir: directory,
      annotations: [],
      titlePath: ['project', 'test'],
      project: { name: 'project', testDir: directory, retries: 0 } as TestInfo['project'],
      testId: 'runner',
      retry: 0,
      file: join(directory, 'test.spec.ts'),
      status: 'passed',
      expectedStatus: 'passed',
      errors: [],
    });
    const envelope = await buildAttemptEnvelope({
      testInfo,
      prelude: {
        catalog: {
          system: base.system,
          catalog: base.configuration.catalog,
          instrumentation: base.configuration.instrumentation,
        },
        source: { source: base.source, branch: null, changedPaths: [] },
        environment: base.configuration.environment,
        startedAt: '2026-01-01T00:00:00.000Z',
      },
      attempt: {
        sandbox: {
          sandboxId: 'sandbox',
          executionId: 'execution',
          artifactDirectory: directory,
        } as BlackboxSandbox,
        telemetry: { sessionId: 'session' } as BlackboxTelemetry,
      },
      snapshot: null,
      recorded: { stimuli: [], unscoped: 0, opaque: 0 },
      attached: report.attachedEvidence(),
    });
    expect(verifyEnvelope(envelope)).toEqual({ ok: true });
    expect(report.attachedEvidence()).toHaveLength(accepted.length);
    expect(envelope.verification.assertions).toHaveLength(accepted.length);
    expect(
      envelope.expectations.declaredInTest.reduce((sum, item) => sum + item.assertions, 0),
    ).toBe(accepted.length);
    for (const { body, name } of accepted) {
      const sequence = sequenceOf(body);
      const id = digestBytes(body);
      const document = JSON.parse(body) as { assertion: { contract: unknown } };
      expect(report.attachedEvidence().find(({ digest }) => digest === id)).toMatchObject({
        sequence,
        bytes: Buffer.byteLength(body),
        contractDigest: digestOf(document.assertion.contract),
      });
      expect(
        envelope.verification.assertions.find(({ evidence }) => evidence === id),
      ).toMatchObject({ sequence, evidence: id, outcome: 'passed' });
      expect(envelope.evidence.find((ref) => ref.id === id)).toMatchObject({
        kind: 'assertion-evidence',
        locator: { type: 'attachment', name, sequence },
      });
    }
    await checkIngestion(directory, envelope, accepted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function checkIngestion(
  directory: string,
  envelope: Awaited<ReturnType<typeof buildAttemptEnvelope>>,
  accepted: readonly Pending[],
) {
  const attachments = [
    ...accepted,
    { name: 'blackbox-envelope', body: JSON.stringify(envelope) },
  ].map(({ name, body }) => ({ name, body: Buffer.from(body).toString('base64') }));
  const resultsPath = join(directory, 'results.json');
  await writeFile(
    resultsPath,
    JSON.stringify({
      suites: [{ specs: [{ tests: [{ results: [{ attachments }] }] }] }],
    }),
  );
  const history = await BehaviorHistory.open(join(directory, 'history'));
  expect(await ingestPlaywrightResults(history, resultsPath)).toMatchObject({
    attempts: 1,
    envelopes: 1,
    assertionBodies: accepted.length,
    rejected: [],
  });
  const detail = await history.execution(envelope.digest);
  expect(detail).not.toBeNull();
  expect(detail!.evidence).toHaveLength(accepted.length);
  for (const { body, name } of accepted) {
    expect(detail!.evidence.find(({ id }) => id === digestBytes(body))).toMatchObject({
      status: 'stored',
      locator: { type: 'attachment', name, sequence: sequenceOf(body) },
    });
  }
}

it('keeps concurrent attachment body, evidence and envelope sequences paired when completed out of order', async () => {
  const { pending, report } = deferredAttachments();
  const first = report.effectAssertion(assertion('/first'));
  const second = report.effectAssertion(assertion('/second'));
  expect(pending.map(({ body }) => sequenceOf(body))).toEqual([1, 2]);
  pending[1].resolve();
  await second;
  pending[0].resolve();
  await first;
  await checkEnvelope(report, [pending[1], pending[0]]);
});

it('never reuses an allocated sequence after a concurrent rejection or registers rejected evidence', async () => {
  const { pending, report } = deferredAttachments();
  const first = report.effectAssertion(assertion('/failed'));
  const rejected = expect(first).rejects.toThrow('attach failed');
  const second = report.effectAssertion(assertion('/accepted'));
  pending[1].resolve();
  await second;
  pending[0].reject(new Error('attach failed'));
  await rejected;
  const third = report.effectAssertion(assertion('/later'));
  expect(pending.map(({ body }) => sequenceOf(body))).toEqual([1, 2, 3]);
  pending[2].resolve();
  await third;
  expect(report.attachedEvidence().map(({ sequence }) => sequence)).toEqual([2, 3]);
  expect(report.attachedEvidence().map(({ digest }) => digest)).not.toContain(
    digestBytes(pending[0].body),
  );
  await checkEnvelope(report, [pending[2], pending[1]]);
});
