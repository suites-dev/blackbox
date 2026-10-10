import { describe, expect, it } from 'vitest';

import {
  executionId,
  first,
  reasonOf,
  report,
  run,
  session,
  sessionId,
} from './causality.fixture.js';

describe('status first', () => {
  it('is provisional while the capsule runs', () => {
    const document = report({
      state: 'running',
      activities: [],
      observations: session(
        [],
        [run({ receiver: 'ready', shutdown: 'not-started', stoppedAt: null })],
      ),
    });
    expect(document.status).toBe('provisional');
    expect(reasonOf(document)).toBeNull();
    expect(document.limitations).toEqual([{ kind: 'observation-provisional' }]);
  });

  it('is complete after a clean stop', () => {
    const document = report({ activities: [], observations: session([]) });
    expect(document.status).toBe('complete');
    expect(document.limitations).toEqual([]);
  });

  it.each([
    ['no collector record', report({ activities: [], observations: session([], []) })],
    [
      'collector shutdown timed out',
      report({ activities: [], observations: session([], [run({ shutdown: 'timed-out' })]) }),
    ],
    [
      'collector interrupted',
      report({ activities: [], observations: session([], [run({ receiver: 'interrupted' })]) }),
    ],
    [
      'collector failed: CollectorBroke',
      report({
        activities: [],
        observations: session([], [run({ failure: { name: 'CollectorBroke', message: 'boom' } })]),
      }),
    ],
    [
      'collector not stopped',
      report({ activities: [], observations: session([], [run({ shutdown: 'draining' })]) }),
    ],
    [
      'capsule start-failed',
      report({ state: 'start-failed', activities: [], observations: session([]) }),
    ],
    [
      'collector session corrupt: CollectorCorrupt',
      report({
        activities: [],
        observations: {
          kind: 'collector-session-corrupt',
          identity: { sessionId, executionId },
          error: { name: 'CollectorCorrupt', message: 'bad' },
        },
      }),
    ],
  ])('is incomplete (%s)', (reason, document) => {
    expect(document.status).toBe('incomplete');
    expect(reasonOf(document)).toBe(reason);
    expect(first(document.limitations)).toEqual({ kind: 'observation-incomplete', reason });
  });
});
