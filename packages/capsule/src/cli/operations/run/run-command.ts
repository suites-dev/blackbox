import {
  execCapsule,
  normalizeCapsuleActivityName,
  type CapsuleActivityName,
  type CapsuleExecInput,
} from '@suites/blackbox-capsule';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES, type UsageExit } from '../../cli/exit-codes.js';
import { cliFailure } from '../../cli/failure.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { runProcessInteractiveCapsuleExec } from '../../capsule/execution/interactive-execution.js';
import { InvocationContext } from '../../context/invocation.js';
import { OutputTracker } from './output-tracker.js';
import { interruptOnSigint } from './run-observe.js';
import { reportRun, type RunReportRequest } from './run-report.js';

export interface RunRequest extends RunReportRequest {
  readonly capsuleFlag: string | null;
  readonly name: string | null;
  readonly allowUntraced: boolean;
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
      throw this.usageFailure('--allow-untraced requires --via');
    }
    const name = this.activityName(request.name);
    const context = new InvocationContext(process.cwd());
    const { capsule } = await context.capsule(request.capsuleFlag, 'exec');
    const summary = (await context.index()).capsule(capsule);
    if (summary !== null && summary.state !== 'running') {
      throw cliFailure(
        'capsule-not-running',
        `capsule ${capsule} is ${summary.state}; run needs a running capsule`,
        ['blackbox capsule up'],
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
    // From the moment the child has exited, Ctrl-C only ends the telemetry
    // wait: it never replaces the child's exit code.
    const interrupt = interruptOnSigint();
    try {
      await reportRun(
        {
          request,
          context,
          capsule,
          summary,
          result,
          durationMs,
          interactive,
          tracker,
          signal: interrupt.signal,
        },
        {
          finish: (code) => {
            this.finish(code);
          },
          human: (lines) => {
            this.human(lines);
          },
          json: (document) => {
            this.json(document);
          },
        },
      );
    } finally {
      interrupt.dispose();
    }
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
