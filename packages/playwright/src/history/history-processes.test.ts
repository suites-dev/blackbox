import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { BehaviorHistory } from './history.js';
import { cleanup, execution, failedAcquisition, behaviorOf, roots } from './history.fixture.js';

afterEach(cleanup);

// Real operating-system processes need compiled code; `pnpm test` builds first. A missing build is a failure,
// not a skip, so this lane cannot quietly stop running.
const compiled = fileURLToPath(new URL('../../dist/history/history.js', import.meta.url));

const WORKER = `
import { readFileSync } from 'node:fs';
const [module, root, plan] = process.argv.slice(2);
const { BehaviorHistory } = await import(module);
const work = JSON.parse(readFileSync(plan, 'utf8'));
const history = await BehaviorHistory.open(root);
for (const item of work.items) {
  if (item.kind === 'envelope') await history.ingestEnvelope(item.envelope, item.body);
  else if (item.kind === 'receipt') await history.ingestReceipt(item.receipt);
  else if (item.kind === 'blob') await history.ingestBlob(item.text);
}
process.exit(0);
`;

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
}

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bb-processes-'));
  roots.push(directory);
  return directory;
}

describe('independent processes writing one store', () => {
  it('has a build to run against', () => {
    expect(existsSync(compiled), `${compiled} is missing: run pnpm build first`).toBe(true);
  });

  it('ingests overlapping records from four processes without loss, duplication or corruption', async () => {
    const directory = await scratch();
    const store = join(directory, 'history');
    await writeFile(join(directory, 'worker.mjs'), WORKER);
    const shared = Array.from({ length: 6 }, (_, index) =>
      execution({ attemptId: `shared-${String(index)}` }),
    );
    const sharedItems = [
      ...shared.map(({ envelope, body }) => ({ kind: 'envelope', envelope, body })),
      { kind: 'receipt', receipt: failedAcquisition(behaviorOf('subscription.payment'), 5) },
    ];
    const children: ChildProcess[] = [];
    for (let worker = 0; worker < 4; worker += 1) {
      const own = Array.from({ length: 5 }, (_, index) =>
        execution({ attemptId: `own-${String(worker)}-${String(index)}` }),
      ).map(({ envelope, body }) => ({ kind: 'envelope', envelope, body }));
      const items = [...own, ...sharedItems].sort(() => Math.random() - 0.5);
      const plan = join(directory, `plan-${String(worker)}.json`);
      await writeFile(plan, JSON.stringify({ items }));
      children.push(
        fork(join(directory, 'worker.mjs'), [new URL(`file://${compiled}`).href, store, plan], {
          stdio: 'inherit',
        }),
      );
    }
    expect(await Promise.all(children.map(exited))).toEqual([0, 0, 0, 0]);
    const history = await BehaviorHistory.open(store);
    const report = await history.verifyStore();
    expect(report.corrupt).toEqual([]);
    expect(report.interruptedWrites).toEqual([]);
    expect(report.objects.envelope).toBe(6 + 4 * 5);
    expect(report.objects.receipt).toBe(1);
    const second = await BehaviorHistory.open(store);
    expect((await second.rebuildIndex()).digest).toBe(report.indexDigest);
  });

  it('is left consistent when a writer is killed with SIGKILL in the middle of ingesting', async () => {
    const directory = await scratch();
    const store = join(directory, 'history');
    await writeFile(join(directory, 'worker.mjs'), WORKER);
    const items = Array.from({ length: 2000 }, (_, index) => ({
      kind: 'blob',
      text: `blob-${String(index)}-${'x'.repeat(2000)}`,
    }));
    const plan = join(directory, 'plan.json');
    await writeFile(plan, JSON.stringify({ items }));
    const child = fork(
      join(directory, 'worker.mjs'),
      [new URL(`file://${compiled}`).href, store, plan],
      { stdio: 'inherit' },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    child.kill('SIGKILL');
    await exited(child);
    const history = await BehaviorHistory.open(store);
    const report = await history.verifyStore();
    // Whatever was written is whole, and anything half-written is a visible leftover, never an object.
    expect(report.corrupt).toEqual([]);
    expect(report.objects.blob).toBeLessThanOrEqual(2000);
    // The same work can be finished by another process: ingestion is idempotent.
    const rerun = fork(
      join(directory, 'worker.mjs'),
      [new URL(`file://${compiled}`).href, store, plan],
      { stdio: 'inherit' },
    );
    expect(await exited(rerun)).toBe(0);
    const finished = await (await BehaviorHistory.open(store)).verifyStore();
    expect(finished.objects.blob).toBe(2000);
    expect(finished.corrupt).toEqual([]);
    await rm(join(store, 'tmp'), { recursive: true, force: true });
  });
});
