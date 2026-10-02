import { expect, it } from 'vitest';

import {
  activeTelemetry,
  completedDriverActivity,
  completedHostActivity,
} from '../../persistence/testing/record.fixture.js';
import type { CapsuleActivityReport } from '../../model/activity.js';
import type { CapsuleExecutionOutcome } from '../../model/outcome.js';
import { activityContext } from '../context.js';

type Propagation = Extract<CapsuleExecutionOutcome, { kind: 'driver-completed' }>['propagation'];

function driverWith(outcome: Propagation['outcome']): CapsuleActivityReport {
  const activity = completedDriverActivity();
  const completed = activity.outcome as Extract<
    CapsuleExecutionOutcome,
    { kind: 'driver-completed' }
  >;
  return {
    ...activity,
    outcome: { ...completed, propagation: { ...completed.propagation, outcome } },
  };
}

it('classifies every propagation outcome', () => {
  expect(
    activityContext(
      driverWith({
        kind: 'context-injected',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
      }),
    ),
  ).toEqual({ kind: 'sent', carrier: 'http-headers' });
  expect(
    activityContext(
      driverWith({ kind: 'context-not-supported', boundary: 'shared-state', resource: 'redis' }),
    ),
  ).toEqual({ kind: 'not-carried', resource: 'redis' });
  expect(activityContext(completedHostActivity())).toEqual({ kind: 'untraced' });
  expect(
    activityContext(driverWith({ kind: 'context-not-injected', reason: 'driver-declared-none' })),
  ).toEqual({
    kind: 'not-sent',
  });
});

it('redacts a credential in an injection failure message', () => {
  const context = activityContext(
    driverWith({
      kind: 'context-injection-failed',
      format: 'w3c-trace-context',
      carrier: 'http-headers',
      message: 'header rejected: Authorization: Bearer live-token-123',
    }),
  );
  expect(JSON.stringify(context)).not.toContain('live-token-123');
  expect(context).toEqual({
    kind: 'injection-failed',
    carrier: 'http-headers',
    message: 'header rejected: Authorization: [REDACTED]',
  });
});

it('has no context when the driver failed before any process existed, or the activity never completed', () => {
  const activity = completedDriverActivity();
  const refused = {
    ...activity,
    outcome: {
      kind: 'driver-propagation-refused',
      driverId: 'http',
      propagation: (
        activity.outcome as Extract<CapsuleExecutionOutcome, { kind: 'driver-completed' }>
      ).propagation,
    },
  } satisfies CapsuleActivityReport;
  expect(activityContext(refused)).toBeNull();
  const host = completedHostActivity();
  const running = {
    kind: 'running',
    activityId: host.activityId,
    sequence: host.sequence,
    name: host.name,
    purpose: host.purpose,
    target: host.target,
    argv: host.argv,
    startedAt: host.startedAt,
    telemetry: activeTelemetry(host.activityId),
  } satisfies CapsuleActivityReport;
  expect(activityContext(running)).toBeNull();
});
