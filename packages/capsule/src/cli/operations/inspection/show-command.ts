import { readCapsuleObservations, type CapsuleObservationsResult } from '@suites/blackbox-capsule';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { terminalText } from '../../progress/terminal-text.js';
import { InvocationContext } from '../../context/invocation.js';
import { pendingTraceView } from './show-output.js';
import { observationSelection, resolveShowTarget } from './show-target.js';
import { showView, type ShowRequest } from './show-view.js';

export type { ShowRequest } from './show-view.js';

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
    const resolved = await resolveShowTarget(context, index, request);
    const capsule = resolved.capsule.capsule;
    const result = await readCapsuleObservations({
      projectDirectory,
      sessionId: capsule,
      selection: observationSelection(resolved),
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
}
