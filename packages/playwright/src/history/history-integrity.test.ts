import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildEnvelope } from '../envelope/build.js';
import { digestBytes } from '../envelope/canonical.js';
import { inputFixture } from '../envelope/envelope.fixture.js';
import { BehaviorHistory } from './history.js';
import {
  behaviorOf,
  cleanup,
  execution,
  failedAcquisition,
  ingest,
  openHistory,
  roots,
} from './history.fixture.js';

afterEach(cleanup);

describe('reading a record that changed after it was indexed', () => {
  const pathOf = (root: string, kind: string, id: string) => {
    const hex = id.slice('sha256:'.length);
    return join(root, 'objects', kind, hex.slice(0, 2), hex);
  };

  it('refuses to return an envelope whose file no longer verifies, instead of serving a stale index entry', async () => {
    const history = await openHistory();
    const spec = execution({ attemptId: 'a' });
    const id = await ingest(history, spec);
    await history.index();
    const file = pathOf(history.root, 'envelope', id);
    const tampered = { ...spec.envelope, source: { ...spec.envelope.source, commit: 'forged' } };
    await rm(file);
    await writeFile(file, JSON.stringify(tampered));
    const reopened = await BehaviorHistory.open(history.root);
    await expect(reopened.execution(id)).rejects.toThrow('no longer verifies');
    await expect(reopened.compare(id, id, { claims: [], record: false })).rejects.toThrow(
      'no longer verifies',
    );
  });

  it('refuses a snapshot blob whose bytes changed and an unparsable envelope', async () => {
    const history = await openHistory();
    const spec = execution({ attemptId: 'a' });
    const id = await ingest(history, spec);
    const snap = spec.envelope.observed.finalSnapshot;
    if (snap.state !== 'attached') {
      throw new Error('fixture must have a snapshot');
    }
    const blob = pathOf(history.root, 'blob', snap.evidence);
    await rm(blob);
    await writeFile(blob, 'changed');
    await expect(history.execution(id)).rejects.toThrow('no longer matches its identity');
    await rm(pathOf(history.root, 'envelope', id));
    await writeFile(pathOf(history.root, 'envelope', id), '{ not json');
    await expect(history.execution(id)).rejects.toThrow('no longer verifies');
  });
});

describe('records stored under the wrong identity', () => {
  it('refuses a valid envelope stored under another envelope identity', async () => {
    const history = await openHistory();
    const a = execution({ attemptId: 'a' });
    const b = execution({ attemptId: 'b' });
    await ingest(history, a);
    await ingest(history, b);
    const path = (id: string) => {
      const hex = id.slice('sha256:'.length);
      return join(history.root, 'objects', 'envelope', hex.slice(0, 2), hex);
    };
    const bytes = await readFile(path(a.envelope.digest));
    await rm(path(b.envelope.digest));
    await writeFile(path(b.envelope.digest), bytes);
    const report = await history.verifyStore();
    expect(report.corrupt).toEqual([
      expect.objectContaining({ kind: 'envelope', id: b.envelope.digest }),
    ]);
    expect((await history.index()).executions.map(({ envelopeId }) => envelopeId)).toEqual([
      a.envelope.digest,
    ]);
  });

  it('refuses a receipt stored under another receipt identity', async () => {
    const history = await openHistory();
    const first = failedAcquisition(behaviorOf('subscription.payment'), 5);
    const second = failedAcquisition(behaviorOf('subscription.payment'), 6);
    await history.ingestReceipt(first);
    await history.ingestReceipt(second);
    const path = (id: string) => {
      const hex = id.slice('sha256:'.length);
      return join(history.root, 'objects', 'receipt', hex.slice(0, 2), hex);
    };
    const bytes = await readFile(path(first.digest));
    await rm(path(second.digest));
    await writeFile(path(second.digest), bytes);
    expect((await history.verifyStore()).corrupt).toEqual([
      expect.objectContaining({ kind: 'receipt', id: second.digest }),
    ]);
    expect((await history.index()).receipts.map(({ id: receipt }) => receipt)).toEqual([
      first.digest,
    ]);
  });
});

describe('blobs and interrupted writes', () => {
  it('flags a blob whose bytes do not match its identity and unparsable records', async () => {
    const history = await openHistory();
    const spec = execution({ attemptId: 'a' });
    await ingest(history, spec);
    const snap = spec.envelope.observed.finalSnapshot;
    if (snap.state !== 'attached') {
      throw new Error('fixture must have a snapshot');
    }
    const hex = snap.evidence.slice('sha256:'.length);
    const file = join(history.root, 'objects', 'blob', hex.slice(0, 2), hex);
    await rm(file);
    await writeFile(file, 'not the snapshot');
    const junk = join(history.root, 'objects', 'receipt', 'ab');
    await mkdir(junk, { recursive: true });
    await writeFile(join(junk, `ab${'0'.repeat(62)}`), '{ not json');
    const report = await history.verifyStore();
    expect(report.corrupt.map(({ kind }) => kind).sort()).toEqual(['blob', 'receipt']);
    expect((await history.index()).executions[0].snapshot).toBe('missing');
  });

  it('lists a write that was interrupted and does not let it into the history', async () => {
    const history = await openHistory();
    await ingest(history, execution({ attemptId: 'a' }));
    await mkdir(join(history.root, 'tmp'), { recursive: true });
    await writeFile(join(history.root, 'tmp', 'envelope-crash.partial'), '{"half":');
    const report = await history.verifyStore();
    expect(report.interruptedWrites).toEqual(['envelope-crash.partial']);
    expect(report.objects.envelope).toBe(1);
    expect(report.corrupt).toEqual([]);
  });
});

describe('evidence references that point outside the evidence root', () => {
  it('refuses a locator that escapes the root or follows a symbolic link out of it, and re-checks inside files', async () => {
    const history = await openHistory();
    const base = join(history.root, '..', 'evidence-escape');
    roots.push(base);
    const root = join(base, 'root');
    await mkdir(root, { recursive: true });
    await writeFile(join(base, 'outside.txt'), 'secret');
    await writeFile(join(root, 'inside.txt'), 'fine');
    await symlink(join(base, 'outside.txt'), join(root, 'link.txt'));
    const ref = (name: string, path: string, content: string) => ({
      id: digestBytes(content),
      kind: 'sandbox-record' as const,
      bytes: content.length,
      locator: { type: 'file' as const, root: 'test-output' as const, path },
      name,
    });
    const refs = [
      ref('escape', '../outside.txt', 'escape'),
      ref('absolute', join(base, 'outside.txt'), 'absolute'),
      ref('link', 'link.txt', 'link'),
      ref('inside', 'inside.txt', 'fine'),
    ].map(({ name: _name, ...rest }) => rest);
    const input = inputFixture();
    const envelope = buildEnvelope({ ...input, evidence: [...input.evidence, ...refs] });
    await history.ingestEnvelope(envelope, null);
    const checks = await history.verifyEvidence(envelope.digest, root);
    expect(
      checks.filter(({ kind }) => kind === 'sandbox-record').map(({ status }) => status),
    ).toEqual(['refused', 'refused', 'refused', 'verified']);
  });
});
