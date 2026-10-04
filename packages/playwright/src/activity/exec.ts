import { randomUUID } from 'node:crypto';

import type { AttemptProgress } from '../reporting/events.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { createAttemptTraceContext } from '../trace/trace-context.js';
import type { BlackboxActivity } from './activity-types.js';

/** `sandbox.exec`, typed here so this module does not import the public type hub. */
export type ParticipantExec = (
  participant: string,
  argv: readonly [string, ...string[]],
) => Promise<BlackboxActivity>;

/**
 * `sandbox.exec`: each command is its own activity with a fresh trace, as with
 * `capsule run`. The attempt report records it; argv is reduced to the executable
 * and an argument count because setup arguments often carry credentials.
 */
export function participantExec(
  attempt: RunningBlackboxAttempt,
  progress: AttemptProgress,
): ParticipantExec {
  return async (participant, argv) => {
    const activityId = randomUUID();
    const trace = createAttemptTraceContext();
    progress.emit(
      'activity',
      'started',
      `${activityId}; setup in ${participant}: ${argv[0]} with ${argv.length - 1} arguments; ` +
        `trace ${trace.traceId}`,
    );
    try {
      const outcome = await attempt.runActivity({
        participant,
        argv,
        activityId,
        traceparent: trace.traceparent,
      });
      progress.emit(
        'activity',
        outcome.exitCode === 0 ? 'completed' : 'failed',
        `${activityId}; exit ${outcome.exitCode}; ${outcome.rootSpan.kind}`,
      );
      return Object.freeze({
        activityId,
        purpose: 'setup' as const,
        participant,
        argv,
        traceId: trace.traceId,
        traceparent: trace.traceparent,
        ...outcome,
      });
    } catch (error) {
      progress.emit('activity', 'failed', `${activityId}; see test error`);
      throw error;
    }
  };
}
