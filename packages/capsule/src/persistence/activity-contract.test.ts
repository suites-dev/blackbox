import { expect, it } from 'vitest';

import type { CapsuleActivityReport } from '../types.js';
import { decodeCapsuleActivities } from './activity-decoder.js';
import {
  activeTelemetry,
  completedDriverActivity,
  completedHostActivity,
  completedTelemetry,
  rawCommandPropagation,
} from './testing/record.fixture.js';

const activity = completedHostActivity();

it.each([
  activity,
  {
    kind: 'running',
    activityId: 'activity-2',
    sequence: 2,
    purpose: 'setup',
    target: { kind: 'host' },
    argv: ['curl'],
    telemetry: activeTelemetry('activity-2'),
    startedAt: '2026-09-23T12:00:02.000Z',
  },
  {
    kind: 'failed',
    activityId: 'activity-3',
    sequence: 3,
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['curl'],
    telemetry: {
      ...completedTelemetry('activity-3'),
      result: { kind: 'telemetry-scope-failed', message: 'spawn failed' },
    },
    error: { name: 'Error', message: 'spawn failed' },
    startedAt: '2026-09-23T12:00:03.000Z',
    completedAt: '2026-09-23T12:00:04.000Z',
  },
  {
    kind: 'interrupted',
    activityId: 'activity-4',
    sequence: 4,
    purpose: 'inspection',
    target: { kind: 'driver', driverId: 'postgres' },
    argv: ['psql'],
    telemetry: {
      ...completedTelemetry('activity-4'),
      result: { kind: 'telemetry-scope-interrupted', reason: 'manager exited' },
    },
    error: { name: 'ManagerInterrupted', message: 'manager exited' },
    startedAt: '2026-09-23T12:00:05.000Z',
    completedAt: '2026-09-23T12:00:06.000Z',
  },
  completedDriverActivity(),
  {
    ...activity,
    activityId: 'activity-5',
    outcome: {
      kind: 'executable-not-found',
      propagation: rawCommandPropagation,
      argv: ['missing-bin'],
      location: { kind: 'host' },
      remediation: 'Install missing-bin on the host.',
    },
  },
  {
    ...activity,
    activityId: 'activity-6',
    target: { kind: 'driver', driverId: 'http' },
    outcome: {
      kind: 'driver-propagation-refused',
      driverId: 'http',
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: {
          kind: 'w3c-trace-context-propagation',
          carrier: 'http-headers',
        },
        outcome: {
          kind: 'context-injection-failed',
          format: 'w3c-trace-context',
          carrier: 'http-headers',
          message: 'the adapter did not inject a header',
        },
      },
    },
  },
] satisfies CapsuleActivityReport[])('preserves strict activity JSON: %j', (value) => {
  expect(decodeCapsuleActivities({ bytes: JSON.stringify([value]) })).toStrictEqual([value]);
});

it.each([
  { target: null },
  { target: {} },
  { target: { kind: 'driver' } },
  { target: { kind: 'participant', participant: 'postgres' } },
  { target: { kind: 'client', clientId: 'old-client' } },
  { purpose: 'future' },
  { telemetry: activeTelemetry('wrong-for-completed') },
  { outcome: { ...activity.outcome, kind: 'future' } },
  {
    outcome: {
      kind: 'signaled',
      argv: ['curl'],
      location: { kind: 'host' },
      stdout: '',
      stderr: '',
      retention: {
        stdout: { kind: 'complete', originalBytes: 0 },
        stderr: { kind: 'complete', originalBytes: 0 },
      },
    },
  },
])('rejects invalid activity state rather than treating it as success: %j', (change) => {
  expect(() =>
    decodeCapsuleActivities({ bytes: JSON.stringify([{ ...activity, ...change }]) }),
  ).toThrow();
});

it.each(['target', 'purpose', 'telemetry', 'outcome'])('rejects a missing activity %s', (field) => {
  const incomplete = Object.fromEntries(
    Object.entries(activity).filter(([name]) => name !== field),
  );
  expect(() => decodeCapsuleActivities({ bytes: JSON.stringify([incomplete]) })).toThrow();
});

it('requires a canonical propagation record on a retained raw command', () => {
  const outcome = Object.fromEntries(
    Object.entries(activity.outcome).filter(([name]) => name !== 'propagation'),
  );
  expect(() =>
    decodeCapsuleActivities({
      bytes: JSON.stringify([{ ...activity, outcome }]),
    }),
  ).toThrow();
});
