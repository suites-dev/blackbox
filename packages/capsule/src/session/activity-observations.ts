import type { CollectorActivityReadResult } from '@suites/blackbox-otel-collector-internal';

import { readCapsuleObservations } from './observations.js';

export async function readCapsuleActivityObservations(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activityId: string;
}): Promise<CollectorActivityReadResult> {
  const result = await readCapsuleObservations({
    ...input,
    selection: { kind: 'activity', activityId: input.activityId },
  });
  switch (result.kind) {
    case 'collector-activity-found':
    case 'collector-activity-missing':
    case 'collector-activity-corrupt':
      return result;
    default:
      throw new Error(`Activity trace query returned ${result.kind}`);
  }
}
