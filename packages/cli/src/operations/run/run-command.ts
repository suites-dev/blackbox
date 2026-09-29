import {
  execCapsule,
  normalizeCapsuleActivityName,
  type CapsuleActivityName,
  type CapsuleActivityPurpose,
  type CapsuleExecInput,
  type CapsuleExecResult,
  type CapsuleProcessOutcome,
} from '@suites/blackbox-capsule-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES, type UsageExit } from '../../cli/exit-codes.js';
import { cliFailure } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { runProcessInteractiveCapsuleExec } from '../../capsule/execution/interactive-execution.js';
import { ActivityDisplay } from '../../context/display.js';
import { InvocationContext } from '../../context/invocation.js';
import { OutputTracker } from './output-tracker.js';
import { processOutcome, runExitCode, runSummaryLines } from './run-output.js';

export interface RunRequest {
  readonly capsuleFlag: string | null;
  readonly driver: string | null;
  readonly driverFlag: '--via' | '--driver';
  readonly name: string | null;
  readonly purpose: CapsuleActivityPurpose;
  readonly allowUntraced: boolean;
  readonly json: boolean;
}

function writeCaptured(process: CapsuleProcessOutcome, tracker: OutputTracker): void {
  if (process.kind === 'executable-not-found') {
    return;
  }
  if (process.stdout.length > 0) {
    globalThis.process.stdout.write(process.stdout);
    tracker.record(process.stdout);
  }
  if (process.stderr.length > 0) {
    globalThis.process.stderr.write(process.stderr);
    tracker.record(process.stderr);
  }
}

/**
 * `run` and its `capsule exec` alias. Every Blackbox failure, including usage
 * and resolution errors, exits 125; only a process outcome passes its code on.
 */
export abstract class RunCommand extends BlackboxCommand {
  protected override readonly usageExit: UsageExit = EXIT_CODES.blackboxFailure;

  protected async executeRun(request: RunRequest): Promise<void> {
    const argv = this.childArgv();
    if (request.driver === null && request.allowUntraced) {
      throw this.usageFailure(`--allow-untraced requires ${request.driverFlag}`);
    }
    const name = this.activityName(request.name);
    const context = new InvocationContext(process.cwd());
    const { capsule } = await context.capsule(request.capsuleFlag, 'exec');
    const summary = (await context.index()).capsule(capsule);
    if (summary !== null && summary.state !== 'running') {
      throw cliFailure(
        'capsule-not-running',
        `capsule ${capsule} is ${summary.state}; run needs a running capsule`,
        ['blackbox up'],
      );
    }
    const execInput = {
      projectDirectory: process.cwd(),
      sessionId: capsule,
      name,
      purpose: request.purpose,
      target:
        request.driver === null
          ? { kind: 'host' as const, argv }
          : {
              kind: 'driver' as const,
              driverId: request.driver,
              argv,
              untraced: request.allowUntraced
                ? { kind: 'allow' as const }
                : { kind: 'refuse' as const },
            },
    } satisfies CapsuleExecInput;
    const tracker = new OutputTracker();
    const interactive = !request.json && process.stdin.isTTY && process.stdout.isTTY;
    const started = Date.now();
    const result = interactive
      ? await runProcessInteractiveCapsuleExec(execInput, tracker)
      : await execCapsule(execInput);
    const durationMs = Date.now() - started;
    if (result.kind !== 'capsule-exec-completed') {
      throw capsulePackageFailure(result, capsule);
    }
    await this.report({ request, context, capsule, result, durationMs, interactive, tracker });
  }

  private async report(input: {
    readonly request: RunRequest;
    readonly context: InvocationContext;
    readonly capsule: string;
    readonly result: Extract<CapsuleExecResult, { kind: 'capsule-exec-completed' }>;
    readonly durationMs: number;
    readonly interactive: boolean;
    readonly tracker: OutputTracker;
  }): Promise<void> {
    const { request, capsule, result } = input;
    // The index loaded before the child ran is reused: the child's output must
    // never depend on another registry read succeeding after it has run.
    // allActivities() never throws (unreadable records are skipped).
    const index = await input.context.index();
    const ids = (await index.allActivities()).map(({ activity }) => activity.activityId);
    const activity = new ActivityDisplay([...ids, result.activityId]).short(result.activityId);
    const next = [nextSteps.showActivity(activity, capsule)];
    if (request.json) {
      this.json({ ...result, capsule, next });
    } else {
      const captured = processOutcome(result.outcome);
      if (!input.interactive && captured !== null) {
        writeCaptured(captured, input.tracker);
      }
      process.stderr.write(input.tracker.separator());
      this.human([
        ...runSummaryLines({
          activity,
          capsule,
          purpose: request.purpose,
          driver: request.driver,
          outcome: result.outcome,
          durationMs: input.durationMs,
        }),
        ...next.map((command) => `→ ${command}`),
      ]);
    }
    this.finish(runExitCode(result.outcome));
  }

  private childArgv(): readonly [string, ...string[]] {
    const separator = this.argv.indexOf('--');
    const argv = separator < 0 ? [] : this.argv.slice(separator + 1);
    if (argv.length === 0) {
      throw this.usageFailure(`${this.displayId()} requires a command after --`);
    }
    return argv as [string, ...string[]];
  }

  private activityName(value: string | null): CapsuleActivityName {
    try {
      return normalizeCapsuleActivityName(
        value === null ? { kind: 'omitted' } : { kind: 'provided', value },
      );
    } catch (error) {
      throw this.usageFailure(error instanceof Error ? error.message : String(error));
    }
  }
}
