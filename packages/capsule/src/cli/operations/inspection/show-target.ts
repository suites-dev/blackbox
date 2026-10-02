import type { CapsuleObservationsInput } from '@suites/blackbox-capsule';

import { CliFailure } from '../../cli/failure.js';
import { isTraceId } from '../../context/identifiers.js';
import type { InvocationContext } from '../../context/invocation.js';
import type { ProjectIndex } from '../../context/project-index.js';
import { resolveId, type Resolved } from '../../context/resolver.js';
import { completenessOf, readSession } from './investigation-data.js';
import type { PendingTrace, ShowRequest } from './show-view.js';

/** The observations read that shows one resolved target. */
export function observationSelection(
  resolved: Resolved | PendingTrace,
): CapsuleObservationsInput['selection'] {
  switch (resolved.kind) {
    case 'capsule':
      return { kind: 'session' };
    case 'activity':
      return { kind: 'activity', activityId: resolved.activity.activityId };
    case 'trace':
    case 'pending-trace':
      return { kind: 'trace', traceId: resolved.traceId };
  }
}

/**
 * A positional capsule ID is the highest-precedence context, so it resolves
 * before any explicit context is checked. Otherwise an explicit context
 * (flag or BLACKBOX_CAPSULE) must name a listed capsule, and narrows the
 * search. A trace ID retained nowhere is still accepted for an explicit
 * capsule whose observation is provisional: its spans may not have arrived.
 */
export async function resolveShowTarget(
  context: InvocationContext,
  index: ProjectIndex,
  request: ShowRequest,
): Promise<Resolved | PendingTrace> {
  const exact = index.capsule(request.id);
  if (exact !== null) {
    return { kind: 'capsule', capsule: exact };
  }
  const explicit = await context.explicit(request.capsuleFlag, 'observations');
  const scope =
    explicit === null
      ? ({ kind: 'project' } as const)
      : ({ kind: 'capsule', capsule: explicit.capsule } as const);
  try {
    return await resolveId(index, request.id, scope);
  } catch (error) {
    // Only the registry's own summary reaches a Capsule read or a path.
    const summary = explicit === null ? null : index.capsule(explicit.capsule);
    const unknownTrace =
      isTraceId(request.id) && error instanceof CliFailure && error.detail.code === 'id-unknown';
    if (summary === null || !unknownTrace) {
      throw error;
    }
    const session = await readSession({
      projectDirectory: index.projectDirectory,
      capsule: summary.capsule,
    });
    if (completenessOf(summary, session).status !== 'provisional') {
      throw error;
    }
    return { kind: 'pending-trace', capsule: summary, traceId: request.id };
  }
}
