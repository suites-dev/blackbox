import { stopCapsule } from '@suites/blackbox-capsule-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { cliErrorDocument, cliFailure, type CliErrorDetail } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { clearCurrentCapsuleIf, type ClearResult } from '../../context/current-capsule.js';
import { InvocationContext } from '../../context/invocation.js';
import { resolveId } from '../../context/resolver.js';

export interface DownRequest {
  readonly positional: string | null;
  readonly capsuleFlag: string | null;
  readonly json: boolean;
}

function currentClearFailure(capsule: string, message: string): CliErrorDetail {
  return {
    code: 'current-capsule-write-failed',
    message: `capsule ${capsule} is stopped but is still the current capsule (${message})`,
    details: [],
    candidates: [],
    next: [],
  };
}

/** `down` and its `capsule stop` alias. */
export abstract class DownCommand extends BlackboxCommand {
  protected async executeDown(request: DownRequest): Promise<void> {
    const context = new InvocationContext(process.cwd());
    const capsule = await this.target(context, request);
    const result = await stopCapsule({
      projectDirectory: process.cwd(),
      sessionId: capsule,
      reason: 'completed',
    });
    if (result.kind !== 'capsule-stopped') {
      throw capsulePackageFailure(result, capsule);
    }
    const cleared = await clearCurrentCapsuleIf(process.cwd(), capsule).then(
      (outcome: ClearResult) => ({ kind: 'ok' as const, outcome }),
      (error: unknown) => ({
        kind: 'failed' as const,
        warning: currentClearFailure(
          capsule,
          error instanceof Error ? error.message : String(error),
        ),
      }),
    );
    const next = [nextSteps.report(capsule)];
    if (request.json) {
      this.json({
        ...result,
        capsule,
        warnings: cleared.kind === 'failed' ? [cliErrorDocument(cleared.warning)] : [],
        next,
      });
    } else {
      this.human([
        result.alreadyStopped
          ? `capsule ${capsule} was already stopped · evidence kept`
          : `capsule ${capsule} stopped · evidence kept`,
        ...(cleared.kind === 'ok' && cleared.outcome === 'cleared'
          ? ['current capsule: none']
          : []),
        ...(cleared.kind === 'failed' ? [`blackbox: ${cleared.warning.message}`] : []),
        ...next.map((command) => `→ ${command}`),
      ]);
    }
    // The capsule is stopped either way; a current-capsule file that still names
    // it is a Blackbox failure the caller must see, as with `up`.
    this.finish(cleared.kind === 'failed' ? EXIT_CODES.blackboxFailure : EXIT_CODES.success);
  }

  /** A positional must be a capsule ID; without one, the resolved capsule. */
  private async target(context: InvocationContext, request: DownRequest): Promise<string> {
    if (request.positional === null) {
      return (await context.capsule(request.capsuleFlag, 'stop')).capsule;
    }
    const resolved = await resolveId(await context.index(), request.positional, {
      kind: 'project',
    });
    if (resolved.kind === 'capsule') {
      return resolved.capsule.capsule;
    }
    const owner = resolved.capsule.capsule;
    const noun = resolved.kind === 'activity' ? 'an activity' : 'a trace';
    throw cliFailure(
      'down-requires-capsule',
      `down takes a capsule ID; ${request.positional} is ${noun} in capsule ${owner}`,
      [nextSteps.down(owner)],
    );
  }
}
