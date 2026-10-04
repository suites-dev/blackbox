import { describe, expect, it } from 'vitest';

import { completedHostActivity } from '../../../persistence/testing/record.fixture.js';
import type { CapsuleProgressEvent } from '../../../progress/events.js';
import { evidenceUpdatedAt, projectObservationPolicy } from '../../policy.js';

const policy = {
  policyId: 'tt-login-traced-v1',
  boundaries: [
    { id: 'effects.http', kind: 'http', authoritativeFor: ['inbound and outbound HTTP'] },
    { id: 'effects.db', kind: 'database', authoritativeFor: ['queries'] },
  ],
  requiredBoundaries: ['effects.http'],
  terminalObservationWindowMs: 5000,
  redaction: {
    requestBodies: 'not-captured',
    headers: ['authorization'],
    dynamicIdentifiers: 'normalized',
  },
};

const resolved = {
  kind: 'observation-policy-resolved',
  sessionId: 'quiet-river-ada',
  sequence: 4,
  at: '2026-09-23T12:00:00.100Z',
  stage: 'catalog',
  policy,
} satisfies CapsuleProgressEvent;

describe('projectObservationPolicy', () => {
  it('keeps the resolved policy and gives every boundary a status, required or not', () => {
    expect(projectObservationPolicy([resolved])).toEqual({
      kind: 'recorded',
      policyId: 'tt-login-traced-v1',
      terminalObservationWindowMs: 5000,
      redaction: policy.redaction,
      requiredBoundaries: ['effects.http'],
      boundaries: [
        { ...policy.boundaries[0], required: true, status: 'not-evaluated' },
        { ...policy.boundaries[1], required: false, status: 'not-evaluated' },
      ],
    });
  });

  it('says not-recorded for a capsule started before the policy was recorded', () => {
    expect(projectObservationPolicy([])).toEqual({ kind: 'not-recorded' });
  });
});

describe('evidenceUpdatedAt', () => {
  it('is the latest of the record, the activities and the progress', () => {
    const activity = completedHostActivity();
    const input = { recordUpdatedAt: '2026-09-23T11:59:59.000Z', activities: [activity] };
    expect(evidenceUpdatedAt({ ...input, progress: [resolved] })).toBe(activity.completedAt);
    const stopped = { ...resolved, at: '2026-09-23T12:10:00.000Z' };
    expect(evidenceUpdatedAt({ ...input, progress: [stopped] })).toBe(stopped.at);
    expect(evidenceUpdatedAt({ ...input, activities: [], progress: [] })).toBe(
      input.recordUpdatedAt,
    );
  });
});
