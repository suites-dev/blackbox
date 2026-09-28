import { stopCapsule } from '@suites/blackbox-capsule-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { PackageFailure, cliFailure } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import { capsuleFailure } from '../../capsule/capsule-output.js';
import { clearCurrentCapsuleIf, type ClearResult } from '../../context/current-capsule.js';
import { InvocationContext } from '../../context/invocation.js';
import { resolveId } from '../../context/resolver.js';

export interface DownRequest {
  readonly positional: string | null;
  readonly capsuleFlag: string | null;
  readonly json: boolean;
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
      throw new PackageFailure({ document: result, text: capsuleFailure({ result, json: false }) });
    }
    const cleared: ClearResult = await clearCurrentCapsuleIf(process.cwd(), capsule).catch(
      () => 'not-current' as const,
    );
    const next = [nextSteps.report(capsule)];
    if (request.json) {
      this.json({ ...result, capsule, next });
    } else {
      this.human([
        result.alreadyStopped
          ? `capsule ${capsule} was already stopped · evidence kept`
          : `capsule ${capsule} stopped · evidence kept`,
        ...(cleared === 'cleared' ? ['current capsule: none'] : []),
        ...next.map((command) => `→ ${command}`),
      ]);
    }
    this.finish(EXIT_CODES.success);
  }

  /** A positional must be a capsule ID; without one, the resolved capsule. */
  private async target(context: InvocationContext, request: DownRequest): Promise<string> {
    if (request.positional === null) {
      return (await context.capsule(request.capsuleFlag)).capsule;
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
