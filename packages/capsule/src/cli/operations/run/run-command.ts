import {
  execCapsule,
  isUnstartedProcess,
  normalizeCapsuleActivityName,
  type CapsuleActivityName,
  type CapsuleActivityPurpose,
  type CapsuleExecInput,
  type CapsuleExecResult,
  type CapsuleProcessOutcome,
} from '@suites/blackbox-capsule';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES, type UsageExit } from '../../cli/exit-codes.js';
import { cliFailure } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import { capsulePackageFailure } from '../../capsule/capsule-output.js';
import { runProcessInteractiveCapsuleExec } from '../../capsule/execution/interactive-execution.js';
import { ActivityDisplay } from '../../context/display.js';
import { InvocationContext } from '../../context/invocation.js';
import type { CapsuleSummary } from '../../context/project-index.js';
import { OutputTracker } from './output-tracker.js';
import { runBlockLines, runDocument, type LiveRunBlock, type RunBlockInput } from './run-block.js';
import { interruptOnSigint, liveBlock, observeRun } from './run-observe.js';
import { processOutcome, runExitCode, runSummaryLines } from './run-output.js';
import { RunTelemetry, type RunSnapshot } from './run-telemetry.js';
import { systemClock } from './run-wait.js';

export interface RunRequest {
  readonly capsuleFlag: string | null;
  readonly driver: string | null;
  readonly name: string | null;
  readonly purpose: CapsuleActivityPurpose;
  readonly allowUntraced: boolean;
  readonly json: boolean;
  /** Longest wait for telemetry after the child exits, in ms; 0 does not wait. */
  readonly waitMs: number;
}

function writeCaptured(process: CapsuleProcessOutcome, tracker: OutputTracker): void {
  if (isUnstartedProcess(process)) {
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
      await this.report({
        request,
        context,
        capsule,
        summary,
        result,
        durationMs,
        interactive,
        tracker,
        signal: interrupt.signal,
      });
    } finally {
      interrupt.dispose();
    }
  }

  private async report(input: {
    readonly request: RunRequest;
    readonly context: InvocationContext;
    readonly capsule: string;
    readonly summary: CapsuleSummary | null;
    readonly result: Extract<CapsuleExecResult, { kind: 'capsule-exec-completed' }>;
    readonly durationMs: number;
    readonly interactive: boolean;
    readonly tracker: OutputTracker;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const { request, capsule, result } = input;
    // The exit code is the child's, decided now: nothing after this point
    // (the telemetry wait, a failed read, Ctrl-C) can change it.
    this.finish(runExitCode(result.outcome));
    // The index loaded before the child ran is reused: the child's output must
    // never depend on another registry read succeeding after it has run.
    // allActivities() never throws (unreadable records are skipped).
    const index = await input.context.index();
    const ids = (await index.allActivities()).map(({ activity }) => activity.activityId);
    const activity = new ActivityDisplay([...ids, result.activityId]).short(result.activityId);
    const next = [nextSteps.showActivity(activity, capsule)];
    const captured = processOutcome(result.outcome);
    if (!request.json) {
      if (!input.interactive && captured !== null) {
        writeCaptured(captured, input.tracker);
      }
      process.stderr.write(input.tracker.separator());
    }
    const [runLine, ...failure] = runSummaryLines({
      activity,
      capsule,
      purpose: request.purpose,
      driver: request.driver,
      outcome: result.outcome,
      durationMs: input.durationMs,
    });
    // A driver that failed before any process existed sent and caused nothing: no wait.
    const observed =
      captured === null || input.summary === null
        ? null
        : await this.observe({
            request,
            summary: input.summary,
            result,
            runLine,
            activity,
            next,
            signal: input.signal,
          });
    if (request.json) {
      // A driver that failed first keeps its phase 1 document: no context or observation.
      this.json({ ...result, capsule, next, ...(observed === null ? {} : runDocument(observed)) });
    } else if (observed === null) {
      this.human([runLine, ...failure, ...next.map((command) => `→ ${command}`)]);
    } else {
      const lines = runBlockLines(observed);
      if (observed.live === null) {
        this.human(lines);
      } else {
        observed.live.end(lines);
      }
    }
  }

  private async observe(input: {
    readonly request: RunRequest;
    readonly summary: CapsuleSummary;
    readonly result: Extract<CapsuleExecResult, { kind: 'capsule-exec-completed' }>;
    readonly runLine: string;
    readonly activity: string;
    readonly next: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<(RunBlockInput & { readonly live: LiveRunBlock | null }) | null> {
    const live = liveBlock(input.request.json);
    const block = (snapshot: RunSnapshot, wait: RunBlockInput['wait']): RunBlockInput => ({
      runLine: input.runLine,
      short: input.activity,
      snapshot,
      wait,
      next: input.next,
    });
    const observed = await observeRun({
      telemetry: new RunTelemetry({
        projectDirectory: process.cwd(),
        capsule: input.summary,
        activityId: input.result.activityId,
      }),
      capMs: input.request.waitMs,
      clock: systemClock,
      signal: input.signal,
      draw: (snapshot, wait) => {
        if (live !== null) {
          live.draw(block(snapshot, wait));
        }
      },
    });
    return observed === null ? null : { ...block(observed.snapshot, observed.wait), live };
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
