import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { CapsuleActivityReport, CapsuleExecutionOutcome } from '../types.js';
import { decodeCapsuleActivities } from './activity-decoder.js';
import { writeCapsuleActivities } from '../records.js';
import {
  activeTelemetry,
  completedDriverActivity,
  completedHostActivity,
  completedTelemetry,
  rawCommandPropagation,
} from './testing/record.fixture.js';

const activity = completedHostActivity();
const driverActivity = completedDriverActivity();
const driverOutcome = driverActivity.outcome as Extract<
  CapsuleExecutionOutcome,
  { readonly kind: 'driver-completed' }
>;

it.each([
  activity,
  {
    kind: 'running',
    activityId: 'activity-2',
    sequence: 2,
    name: { kind: 'omitted' },
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
    name: { kind: 'provided', value: 'Submit order' },
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
    name: { kind: 'omitted' },
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
    activityId: 'activity-7',
    outcome: {
      kind: 'not-executable',
      propagation: rawCommandPropagation,
      argv: ['./not-executable'],
      location: { kind: 'host' },
      remediation:
        './not-executable is not executable; check its permissions or run it through its interpreter',
    },
  },
  {
    ...driverActivity,
    activityId: 'activity-8',
    outcome: {
      ...driverOutcome,
      process: {
        kind: 'not-executable',
        argv: ['./tool'],
        location: { kind: 'host' },
        remediation: './tool is not executable; check its permissions or run it through its interpreter',
      },
    },
  },
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
  { name: { kind: 'future' } },
  { name: { kind: 'provided', value: '' } },
  { name: { kind: 'provided', value: '   ' } },
  { name: { kind: 'provided', value: 'a'.repeat(121) } },
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
  {
    outcome: {
      kind: 'not-executable',
      propagation: rawCommandPropagation,
      argv: ['./tool'],
      location: { kind: 'host' },
    },
  },
  {
    outcome: {
      kind: 'not-executable',
      propagation: rawCommandPropagation,
      argv: ['./tool'],
      location: { kind: 'host' },
      remediation: 'x',
      stdout: '',
    },
  },
])('rejects invalid activity state rather than treating it as success: %j', (change) => {
  expect(() =>
    decodeCapsuleActivities({ bytes: JSON.stringify([{ ...activity, ...change }]) }),
  ).toThrow();
});

it.each(['name', 'target', 'purpose', 'telemetry', 'outcome'])(
  'rejects a missing activity %s',
  (field) => {
  const incomplete = Object.fromEntries(
    Object.entries(activity).filter(([name]) => name !== field),
  );
  expect(() => decodeCapsuleActivities({ bytes: JSON.stringify([incomplete]) })).toThrow();
  },
);

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

/**
 * Bytes exactly as phase 1 persisted them (before not-executable existed): a
 * host activity whose executable was missing, and a driver activity that
 * exited. They must decode to the very same value.
 */
const PHASE_ONE_ACTIVITIES = String.raw`[{"kind":"completed","activityId":"0b7f3e0c-1f2a-4d5b-8c6d-7e8f9a0b1c2d","sequence":1,"name":{"kind":"omitted"},"purpose":"stimulus","target":{"kind":"host"},"argv":["definitely-not-a-command"],"telemetry":{"schemaVersion":1,"kind":"telemetry-execution-scope-completed-v1","executionId":"0b7f3e0c-1f2a-4d5b-8c6d-7e8f9a0b1c2d","operationName":"capsule.host","startedAt":"2026-09-01T10:00:00.000Z","endedAt":"2026-09-01T10:00:00.050Z","result":{"kind":"telemetry-scope-failed","message":"Activity completed with executable-not-found"},"context":{"kind":"w3c-trace-context","traceId":"11111111111111111111111111111111","spanId":"2222222222222222","traceFlags":"01","traceparent":"00-11111111111111111111111111111111-2222222222222222-01","traceState":{"kind":"trace-state-absent"}}},"outcome":{"kind":"executable-not-found","argv":["definitely-not-a-command"],"location":{"kind":"host"},"remediation":"Install \"definitely-not-a-command\" on the host or select a driver with participant execution.","propagation":{"schemaVersion":1,"kind":"telemetry-propagation-v1","expectation":{"kind":"propagation-not-requested"},"outcome":{"kind":"context-not-injected","reason":"raw-command"}}},"startedAt":"2026-09-01T10:00:00.000Z","completedAt":"2026-09-01T10:00:00.050Z"}]`;

it('decodes an activity record persisted before not-executable existed, unchanged', () => {
  expect(decodeCapsuleActivities({ bytes: PHASE_ONE_ACTIVITIES })).toStrictEqual(
    JSON.parse(PHASE_ONE_ACTIVITIES),
  );
});

it('audit #1: invalid activity purpose cannot brick session cleanup', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-audit-1-'));
  try {
    await mkdir(join(projectDirectory, '.blackbox', 'experiments', 'capsule-quiet-river-ada'), {
      recursive: true,
    });
    const invalid = JSON.parse(JSON.stringify({ ...activity, purpose: 'invalid-purpose' }));
    await expect(writeCapsuleActivities({
      projectDirectory,
      sessionId: 'quiet-river-ada',
      activities: [invalid],
    })).rejects.toThrow();
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
