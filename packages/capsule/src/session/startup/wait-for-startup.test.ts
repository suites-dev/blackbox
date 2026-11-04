import { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import type { CapsuleProgressEvent } from '../../progress/events.js';
import { createCapsuleProgressRenderer } from '../../cli/capsule/capsule-progress.js';
import { runningRecord } from '../recovery/recovery.fixture.js';
import { waitForStartup } from './wait-for-startup.js';

describe('startup terminal progress', () => {
  it('delivers failure committed between the journal read and terminal record read', async () => {
    const record = {
      ...runningRecord('/unused-startup-observer-fixture'),
      state: 'manager-failed' as const,
      failure: {
        kind: 'recorded' as const,
        error: { name: 'Error', message: 'Catalog unavailable' },
      },
    };
    const failure = {
      kind: 'capsule-start-failed',
      sessionId: record.sessionId,
      sequence: 1,
      at: record.updatedAt,
      stage: 'catalog-load',
      cause: record.failure.error,
    } satisfies CapsuleProgressEvent;
    let journal: readonly CapsuleProgressEvent[] = [];
    const reads: string[] = [];
    const delivered: CapsuleProgressEvent[] = [];
    const output: string[] = [];
    const renderer = createCapsuleProgressRenderer({
      presentation: 'interactive',
      color: false,
      write: (text) => output.push(text),
    });
    const result = await waitForStartup(
      {
        projectDirectory: '/unused-startup-observer-fixture',
        sessionId: record.sessionId,
        manager: new ChildProcess(),
        progress: {
          kind: 'interactive',
          sink: (event) => {
            delivered.push(event);
            renderer.sink(event);
          },
        },
      },
      {
        readProgress: () => {
          reads.push('journal');
          return Promise.resolve(journal);
        },
        readRecord: () => {
          reads.push('record');
          // The manager commits its failure journal before its terminal record.
          // The observer has already read the preceding journal snapshot.
          journal = [failure];
          return Promise.resolve(record);
        },
      },
    );
    renderer.finish();
    expect(result).toBe(record);
    expect(delivered).toEqual([failure]);
    expect(output.join('')).toContain('Capsule start failed');
    expect(output.join('')).not.toContain('Startup observation ended before Capsule readiness');
    expect(reads).toEqual(['journal', 'record', 'journal']);
  });
});
