import {
  readCapsuleObservations,
  type CapsuleObservationsInput,
  type CapsuleObservationsResult,
} from '@suites/blackbox-capsule';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { CliFailure } from '../../cli/failure.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { isTraceId } from '../../context/identifiers.js';
import { terminalText } from '../../progress/terminal-text.js';
import { InvocationContext } from '../../context/invocation.js';
import type { ProjectIndex } from '../../context/project-index.js';
import { resolveId, type Resolved } from '../../context/resolver.js';
import { completenessOf, readSession } from './investigation-data.js';
import { pendingTraceView } from './show-output.js';
import { showView, type PendingTrace, type ShowRequest } from './show-view.js';

export type { ShowRequest } from './show-view.js';

function selection(resolved: Resolved | PendingTrace): CapsuleObservationsInput['selection'] {
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

type PackageFailureResult = Extract<
  CapsuleObservationsResult,
  { kind: 'capsule-not-found' | 'capsule-invalid-state' | 'capsule-operation-failed' }
>;

function isPackageFailure(result: CapsuleObservationsResult): result is PackageFailureResult {
  return (
    result.kind === 'capsule-not-found' ||
    result.kind === 'capsule-invalid-state' ||
    result.kind === 'capsule-operation-failed'
  );
}

/** `show` and its `observations` alias. Works on stopped capsules. */
export abstract class ShowCommand extends BlackboxCommand {
  protected async executeShow(request: ShowRequest): Promise<void> {
    const projectDirectory = process.cwd();
    const context = new InvocationContext(projectDirectory);
    const index = await context.index();
    const resolved = await this.resolve(context, index, request);
    const capsule = resolved.capsule.capsule;
    const result = await readCapsuleObservations({
      projectDirectory,
      sessionId: capsule,
      selection: selection(resolved),
    });
    if (isPackageFailure(result)) {
      throw capsulePackageFailure(result, capsule);
    }
    const view =
      // Only a trace the collector reports missing is "not observed yet"; a
      // corrupt read is shown like any other trace, never as pending.
      resolved.kind === 'pending-trace' && result.kind === 'collector-trace-missing'
        ? pendingTraceView({ traceId: resolved.traceId, capsule })
        : await showView({ projectDirectory, index, resolved, result, request });
    if (request.json) {
      this.json({ ...result, capsule, next: view.next, ...view.document });
    } else {
      // Service names, span names, titles and activity names come from telemetry
      // and records: no control character or escape sequence reaches the terminal.
      this.human([...view.lines, ...view.next.map((command) => `→ ${command}`)].map(terminalText));
    }
    this.finish(EXIT_CODES.success);
  }

  /**
   * A positional capsule ID is the highest-precedence context, so it resolves
   * before any explicit context is checked. Otherwise an explicit context
   * (flag or BLACKBOX_CAPSULE) must name a listed capsule, and narrows the
   * search. A trace ID retained nowhere is still accepted for an explicit
   * capsule whose observation is provisional: its spans may not have arrived.
   */
  private async resolve(
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
}
