import { expect, it } from 'vitest';
import type { CapsuleActivityReport } from '../types.js';
import { decodeCapsuleActivities } from './decoder.js';

const activity = {
  sequence: 1,
  target: { kind: 'host' },
  argv: ['curl', 'http://localhost'],
  outcome: {
    kind: 'exited',
    argv: ['curl', 'http://localhost'],
    exitCode: 0,
    stdout: '',
    stderr: '',
  },
  startedAt: '2026-09-23T12:00:00.000Z',
  completedAt: '2026-09-23T12:00:01.000Z',
} satisfies CapsuleActivityReport;

it.each([
  activity,
  {
    ...activity,
    target: { kind: 'participant', participant: 'postgres' },
    outcome: { kind: 'signaled', argv: ['psql'], signal: 'SIGTERM', stdout: '', stderr: '' },
  },
] satisfies CapsuleActivityReport[])(
  'preserves target and execution outcome through persisted JSON: %j',
  (value) => {
    expect(decodeCapsuleActivities({ bytes: JSON.stringify([value]) })).toStrictEqual([value]);
  },
);

it.each([
  { target: null },
  { target: {} },
  { target: { kind: 'participant' } },
  { target: { kind: 'future' } },
  { outcome: { ...activity.outcome, kind: 'future' } },
  { outcome: { kind: 'signaled', argv: [], stdout: '', stderr: '' } },
  { outcome: { kind: 'exited', argv: [], stdout: '', stderr: '' } },
])('rejects invalid target/outcome rather than treating it as host success: %j', (change) => {
  expect(() =>
    decodeCapsuleActivities({ bytes: JSON.stringify([{ ...activity, ...change }]) }),
  ).toThrow();
});

it.each(['target', 'outcome'])('rejects a missing activity %s', (field) => {
  const incomplete = Object.fromEntries(
    Object.entries(activity).filter(([name]) => name !== field),
  );
  expect(() => decodeCapsuleActivities({ bytes: JSON.stringify([incomplete]) })).toThrow();
});
