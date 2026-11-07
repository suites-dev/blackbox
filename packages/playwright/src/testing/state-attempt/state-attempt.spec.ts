import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createBlackboxTest } from '../../fixtures.js';
import { createUnavailableBlackboxEffects } from '../../effects/runtime.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';
import type {
  StateCheckpoint,
  StateObserver,
  StateReaders,
  StateSelection,
} from '../../state/types.js';

const runtime = {
  start(input) {
    if (input.selection.kind !== 'system') {
      throw new Error('test system is required');
    }
    const executionId = randomUUID();
    return Promise.resolve({
      sandbox: {
        sandboxId: executionId,
        executionId,
        catalogEntry: { id: input.selection.id, kind: input.selection.kind },
        projectName: `blackbox-${executionId}`,
        artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: `session-${executionId}`,
        executionId,
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used')),
        readTrace: () => Promise.reject(new Error('not used')),
      },
      effects: createUnavailableBlackboxEffects({
        sessionId: `session-${executionId}`,
        executionId,
      }),
      stop: () => Promise.resolve(),
    });
  },
} satisfies BlackboxAttemptRuntime;
const test = createBlackboxTest(runtime);
test.use({ blackbox: { system: { kind: 'system', id: 'orders' } } });

interface Readers extends StateReaders {
  rows: () => { id: string; status: string }[];
}
let previous: {
  observer: StateObserver<Readers>;
  selection: StateSelection;
  checkpoint: StateCheckpoint;
};

test('captures immutable state through the native attempt fixture', async ({
  state,
  _blackboxState,
}) => {
  const rows = [{ id: 'pi_1', status: 'pending' }];
  let calls = 0;
  const observer = state.observe('payments', {
    rows: () => {
      calls++;
      return rows;
    },
  });
  expect(calls).toBe(0);
  const selection = _blackboxState.select();
  const initial = await selection.capture();
  rows[0].status = 'succeeded';
  const final = await selection.capture();
  expect(
    selection.between(initial.checkpoint, final.checkpoint, observer).diff.rows.changed,
  ).toEqual([
    { before: { id: 'pi_1', status: 'pending' }, after: { id: 'pi_1', status: 'succeeded' } },
  ]);
  previous = { observer, selection, checkpoint: initial.checkpoint };
});

test('rejects handles and checkpoints from an earlier native attempt', async ({
  state,
  _blackboxState,
}) => {
  const own = state.observe('payments', { rows: () => [] });
  const selection = _blackboxState.select();
  const checkpoint = (await selection.capture()).checkpoint;
  expect(() => selection.initial(checkpoint, previous.observer)).toThrow('foreign');
  expect(() => selection.initial(previous.checkpoint, own)).toThrow('foreign');
  expect(() => previous.selection.initial(previous.checkpoint, previous.observer)).toThrow(
    'expired',
  );
});
