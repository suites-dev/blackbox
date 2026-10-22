import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { retainedEvidence } from '../../envelope/capture/evidence.js';
import { buildEnvelope } from '../../envelope/build.js';
import { digestBytes } from '../../envelope/index.js';
import { inputFixture } from '../../envelope/testing/envelope.fixture.js';
import { BehaviorHistory } from '../history.js';
import { cleanup, execution, ingest, openHistory, roots } from './history.fixture.js';

afterEach(cleanup);

const snapshot = async (history: BehaviorHistory) => ({
  behaviors: await history.behaviors(),
  entries: await history.behaviorHistory('subscription.payment', { followAliases: false }),
});

describe('rebuild and restart', () => {
  it('gives identical query results after the index is deleted and rebuilt from the records', async () => {
    const history = await openHistory();
    await ingest(history, execution({ attemptId: 'a', capturedAt: '2026-01-01T00:00:10.000Z' }));
    await ingest(
      history,
      execution({ attemptId: 'b', capturedAt: '2026-01-01T00:00:20.000Z', commit: 'c2' }),
    );
    const before = await snapshot(history);
    const digest = (await history.index()).digest;
    await rm(join(history.root, 'index'), { recursive: true, force: true });
    const reopened = await BehaviorHistory.open(history.root);
    expect(await snapshot(reopened)).toEqual(before);
    expect((await reopened.rebuildIndex()).digest).toBe(digest);
  });

  it('restores everything from the records alone after a restart, using the persisted index', async () => {
    const history = await openHistory();
    await ingest(history, execution({ attemptId: 'a' }));
    await history.index();
    const second = await BehaviorHistory.open(history.root);
    expect((await second.behaviors())[0].executions).toBe(1);
    expect((await second.index()).digest).toBe((await history.index()).digest);
  });

  it('sees a record another process wrote only after refresh, and never loses either writer', async () => {
    const history = await openHistory();
    const other = await BehaviorHistory.open(history.root);
    const a = execution({ attemptId: 'a' });
    await Promise.all([
      ingest(history, a),
      ingest(other, execution({ attemptId: 'b' })),
      ingest(other, a),
    ]);
    expect((await history.refresh()).executions).toHaveLength(2);
    expect((await other.refresh()).executions).toHaveLength(2);
  });
});

describe('corruption and interrupted writes', () => {
  it('quarantines a corrupt record, keeps serving the rest, and reports it', async () => {
    const history = await openHistory();
    const good = await ingest(history, execution({ attemptId: 'a' }));
    const bad = execution({ attemptId: 'b' });
    await ingest(history, bad);
    const hex = bad.envelope.digest.slice('sha256:'.length);
    const file = join(history.root, 'objects', 'envelope', hex.slice(0, 2), hex);
    await rm(file, { force: true });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ ...bad.envelope, source: { ...bad.envelope.source, commit: 'forged' } }),
    );
    const report = await history.verifyStore();
    expect(report.corrupt).toEqual([
      expect.objectContaining({ kind: 'envelope', id: bad.envelope.digest }),
    ]);
    expect((await history.index()).executions.map(({ envelopeId }) => envelopeId)).toEqual([good]);
    expect(await history.execution(good)).not.toBeNull();
  });
});

describe('evidence references', () => {
  it('re-checks retained files against the digests an envelope recorded', async () => {
    const history = await openHistory();
    const root = join(history.root, '..', 'evidence-root');
    roots.push(root);
    const record = join(root, 'blackbox', 'attempt.json');
    const run = join(root, 'blackbox', 'attempt.compose', 'collector', 's', 'e');
    await mkdir(join(run, 'fragments'), { recursive: true });
    await writeFile(record, '{"sandboxId":"attempt"}');
    await writeFile(join(run, 'collector-lifecycle.json'), '{"revision":1}');
    await writeFile(join(run, 'fragments', '1.json'), 'fragment');
    const refs = await retainedEvidence({
      root,
      sandboxRecord: record,
      collectorDirectory: join(root, 'blackbox', 'attempt.compose', 'collector'),
    });
    const base = inputFixture();
    const envelope = buildEnvelope({ ...base, evidence: [...base.evidence, ...refs] });
    await history.ingestEnvelope(envelope, null);
    const clean = await history.verifyEvidence(envelope.digest, root);
    expect(
      clean
        .filter(({ status }) => status === 'verified')
        .map(({ kind }) => kind)
        .sort(),
    ).toEqual(['collector-fragments', 'collector-lifecycle', 'sandbox-record']);
    await writeFile(join(run, 'fragments', '1.json'), 'changed');
    await rm(record);
    const changed = await history.verifyEvidence(envelope.digest, root);
    expect(Object.fromEntries(changed.map(({ kind, status }) => [kind, status]))).toMatchObject({
      'collector-fragments': 'mismatch',
      'sandbox-record': 'missing',
      'collector-lifecycle': 'verified',
    });
    expect(digestBytes(await readFile(join(run, 'collector-lifecycle.json')))).toBeDefined();
  });
});
