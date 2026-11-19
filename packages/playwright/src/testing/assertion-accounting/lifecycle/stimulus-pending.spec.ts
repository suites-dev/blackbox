import { createBlackboxTest } from '../../../fixtures.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { deferred, record } from '../evidence.fixture.js';

const test = createBlackboxTest({
  start(input) {
    const executionId = 'pending-lifecycle';
    return Promise.resolve({
      sandbox: {
        sandboxId: executionId, executionId, catalogEntry: { id: 'synthetic', kind: 'system' },
        projectName: executionId, artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'synthetic', executionId,
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used')),
        readTrace: () => Promise.reject(new Error('not used')),
      },
      effects: createAttemptEffects({ sessionId: 'synthetic', executionId, storageDirectory: input.artifactDirectory }).effects,
      stop: () => { record('pending-lifecycle-cleanup', 'completed'); return Promise.resolve(); },
    });
  },
});
test.use({ blackbox: { system: { kind: 'system', id: 'synthetic' }, finalSnapshot: false } });

test('pending public stimulus action fails teardown', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  void stimulus('When action never settles', async () => {
    entered.resolve(undefined);
    await new Promise<never>(() => undefined);
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'action', calls: 1 });
});

test('pending public precondition fails teardown without action', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  let calls = 0;
  void stimulus('When precondition never settles', () => { calls++; }, {
    precondition: { name: 'Given unfinished checking', check: async () => {
      entered.resolve(undefined);
      await new Promise<never>(() => undefined);
    } },
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'precondition', calls });
});

test('pending public verification fails teardown', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  let calls = 0;
  const outcome = await stimulus('When action completes', () => { calls++; });
  void outcome.verify('Then verification never settles', async () => {
    entered.resolve(undefined);
    await new Promise<never>(() => undefined);
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'claim', calls });
});
