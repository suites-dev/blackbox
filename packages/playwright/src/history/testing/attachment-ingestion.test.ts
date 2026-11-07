import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { buildEnvelope } from '../../envelope/build.js';
import { digestBytes, digestOf } from '../../envelope/index.js';
import { inputFixture } from '../../envelope/testing/envelope.fixture.js';
import { nativeResult, verifyNativeResult } from '../receipts/native-result.js';
import { BehaviorHistory } from '../history.js';
import { ingestPlaywrightResults } from '../ingestion/playwright-results.js';
import { defined } from './history.fixture.js';

it('retains referenced attachment bytes across separate attempts and rejects mismatched bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-attachment-history-'));
  try {
    const body = JSON.stringify({ kind: 'emission', value: 'first' });
    const id = digestBytes(body);
    const input = inputFixture();
    const ref = {
      id,
      kind: 'assertion-evidence' as const,
      bytes: Buffer.byteLength(body),
      locator: { type: 'attachment' as const, name: 'blackbox-emissions', sequence: 1 },
    };
    const first = buildEnvelope({ ...input, evidence: [ref] });
    const secondId = digestBytes('different expected body');
    const second = buildEnvelope({
      ...input,
      attempt: { ...input.attempt, retry: 1 },
      evidence: [{ ...ref, id: secondId, bytes: Buffer.byteLength('different expected body') }],
    });
    const attachment = (name: string, data: string) => ({
      name,
      body: Buffer.from(data).toString('base64'),
    });
    const results = join(directory, 'results.json');
    await writeFile(
      results,
      JSON.stringify({
        suites: [
          {
            specs: [
              {
                tests: [
                  {
                    results: [
                      {
                        attachments: [
                          attachment('blackbox-envelope', JSON.stringify(first)),
                          attachment('blackbox-emissions', body),
                        ],
                      },
                      {
                        attachments: [
                          attachment('blackbox-envelope', JSON.stringify(second)),
                          attachment('blackbox-emissions', `${body} `),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const history = await BehaviorHistory.open(join(directory, 'history'));
    const summary = await ingestPlaywrightResults(history, results);
    expect(summary).toMatchObject({ attempts: 2, envelopes: 2, rejected: [] });
    expect(defined(await history.execution(first.digest)).evidence).toContainEqual(
      expect.objectContaining({ id, status: 'stored' }),
    );
    expect(defined(await history.execution(second.digest)).evidence).toContainEqual(
      expect.objectContaining({ id: secondId, status: 'not-checked' }),
    );
    expect((await history.verifyStore()).objects.blob).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains final runner outcomes across duplicate reports, rebuilds, and conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-final-result-'));
  try {
    const envelope = buildEnvelope(inputFixture());
    const body = Buffer.from(JSON.stringify(envelope)).toString('base64');
    const path = join(directory, 'results.json');
    const report = async (status: string) => writeFile(path, JSON.stringify({ suites: [{ specs: [{ tests: [{ results: [{ status, attachments: [{ name: 'blackbox-envelope', body }] }] }] }] }] }));
    const history = await BehaviorHistory.open(join(directory, 'history'));
    await report('failed');
    await ingestPlaywrightResults(history, path);
    await ingestPlaywrightResults(history, path);
    let index = await history.rebuildIndex();
    expect(index.nativeResults).toHaveLength(1);
    await history.ingestNativeResult(nativeResult({ kind: 'playwright-result', version: 1, envelope: envelope.digest, attemptId: 'foreign-attempt', status: 'passed' }));
    index = await history.rebuildIndex();
    expect(index.executions[0].testStatus).toBe('failed');
    expect(index.executions[0]).toMatchObject({ testStatus: 'failed', finalStatus: 'failed', captureTestStatus: envelope.verification.testStatus.status });
    expect((await history.behaviorHistory(envelope.identity.behavior.id, { followAliases: false }))[0].status).toBe('failed');
    await report('passed');
    await ingestPlaywrightResults(history, path);
    index = await history.rebuildIndex();
    expect(index.nativeResults).toHaveLength(3);
    expect(index.executions[0]).toMatchObject({ testStatus: 'conflicting', finalStatus: 'conflicting', statusDiscrepancy: true });
    expect((await history.behaviorHistory(envelope.identity.behavior.id, { followAliases: false }))[0].status).toBe('conflicting');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects a digest-valid native result with a non-string status', () => {
  const body = { kind: 'playwright-result', version: 1, envelope: digestBytes('envelope'), attemptId: 'attempt', status: ['passed'] };
  expect(verifyNativeResult({ ...body, digest: digestOf(body) }).ok).toBe(false);
});
