import {
  isUnstartedProcess,
  type CapsuleActivityPurpose,
  type CapsuleExecResult,
  type CapsuleProcessOutcome,
} from '@suites/blackbox-capsule';

import { redactOutcomeArgv } from '../../../reporting/redaction.js';
import { nextSteps } from '../../cli/next-steps.js';
import { ActivityDisplay } from '../../context/display.js';
import type { InvocationContext } from '../../context/invocation.js';
import type { CapsuleSummary } from '../../context/project-index.js';
import type { OutputTracker } from './output-tracker.js';
import { runBlockLines, runDocument } from './run-block.js';
import { observeActivity } from './run-observe.js';
import { processOutcome, runExitCode, runSummaryLines } from './run-output.js';

/** What reporting a run reads from its request. */
export interface RunReportRequest {
  readonly purpose: CapsuleActivityPurpose;
  readonly driver: string | null;
  readonly json: boolean;
  /** Longest wait for telemetry after the child exits, in ms; 0 does not wait. */
  readonly waitMs: number;
}

/** The command output a run report writes to. */
export interface RunReportOutput {
  readonly finish: (code: number) => void;
  readonly human: (lines: readonly string[]) => void;
  readonly json: (document: unknown) => void;
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
 * Reports a completed run: sets the child's exit code, writes its captured
 * output, waits for its telemetry and prints the run block or JSON document.
 */
export async function reportRun(
  input: {
    readonly request: RunReportRequest;
    readonly context: InvocationContext;
    readonly capsule: string;
    readonly summary: CapsuleSummary | null;
    readonly result: Extract<CapsuleExecResult, { kind: 'capsule-exec-completed' }>;
    readonly durationMs: number;
    readonly interactive: boolean;
    readonly tracker: OutputTracker;
    readonly signal: AbortSignal;
  },
  output: RunReportOutput,
): Promise<void> {
  const { request, capsule, result } = input;
  // The exit code is the child's, decided now: nothing after this point
  // (the telemetry wait, a failed read, Ctrl-C) can change it.
  output.finish(runExitCode(result.outcome));
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
      : await observeActivity({
          json: request.json,
          waitMs: request.waitMs,
          summary: input.summary,
          activityId: result.activityId,
          runLine,
          activity,
          next,
          signal: input.signal,
        });
  if (request.json) {
    // A driver that failed first keeps its phase 1 document: no context or observation.
    // The command line can carry credentials: every argv is redacted as the
    // report redacts it (argv[0] kept); the field keeps its place and type.
    output.json({
      ...result,
      outcome: redactOutcomeArgv(result.outcome),
      capsule,
      next,
      ...(observed === null ? {} : runDocument(observed)),
    });
  } else if (observed === null) {
    output.human([runLine, ...failure, ...next.map((command) => `→ ${command}`)]);
  } else {
    const lines = runBlockLines(observed);
    if (observed.live === null) {
      output.human(lines);
    } else {
      observed.live.end(lines);
    }
  }
}
