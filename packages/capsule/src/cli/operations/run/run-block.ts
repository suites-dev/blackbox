import { activityContext } from '@suites/blackbox-capsule';

import { TerminalBlock, type TerminalViewport } from '../../progress/terminal-block.js';
import {
  activityView,
  driverOf,
  uncausedLines,
  type ActivityViewInput,
} from '../inspection/show-activity.js';
import { contextText, field, showDuration, statusText } from '../inspection/show-format.js';
import { observationDocument, type TelemetryWait } from '../inspection/show-json.js';
import type { RunSnapshot } from './run-telemetry.js';
import { RUN_TREE_MAX_LINES, runTreeLines } from './run-tree.js';

export interface RunBlockInput {
  /** The phase 1 run line, unchanged. */
  readonly runLine: string;
  readonly short: string;
  readonly snapshot: RunSnapshot;
  readonly wait: TelemetryWait;
  /** The `→ …` suggestion lines. */
  readonly next: readonly string[];
}

function viewInput(input: RunBlockInput): ActivityViewInput {
  return { short: input.short, ...input.snapshot };
}

/**
 * The block `run` prints after the child's own output: the run line, the
 * activity's context, what was observed of its own trace (a filtered tree),
 * later traces with no known cause, and the next suggestion. Never prints the
 * command's argv.
 */
export function runBlockLines(
  input: RunBlockInput,
  maxTreeLines: number = RUN_TREE_MAX_LINES,
): readonly string[] {
  const { activity, investigation } = input.snapshot;
  const context = activityContext(activity);
  const observation = observationDocument(viewInput(input), input.wait);
  const status = statusText(investigation.data.completeness);
  const observed =
    observation.spans === 0
      ? [field('observed', `nothing yet · ${status}`)]
      : [
          field(
            'observed',
            `${String(observation.traces.length)} traces · ${String(observation.services.length)} services · ${String(observation.spans)} spans · ${status}`,
          ),
          ...runTreeLines(
            investigation.tree(activity.telemetry.context.traceId).roots,
            maxTreeLines,
          ).map((line) => `    ${line}`),
        ];
  return [
    input.runLine,
    ...(context === null ? [] : [field('context', contextText(context, driverOf(activity)))]),
    ...observed,
    ...uncausedLines(viewInput(input), investigation.data.capsule.capsule),
    ...(input.wait.stillArriving
      ? [
          `  ⚠ spans were still arriving when the wait ended after ${showDuration(input.wait.waitedMs)}.`,
        ]
      : []),
    ...input.next.map((command) => `→ ${command}`),
  ];
}

/** `context`, `observation` and `limitations`, exactly as `show <activity> --json` builds them. */
export function runDocument(input: RunBlockInput): Readonly<Record<string, unknown>> {
  return activityView(viewInput(input), input.wait).document;
}

/**
 * The block drawn on a terminal while the wait runs, redrawn in place as
 * spans arrive. Frames fit the viewport (fewer tree lines, never other
 * text); the final block is written in full below the cleared frame.
 */
export class LiveRunBlock {
  readonly #block: TerminalBlock;
  readonly #write: (text: string) => void;
  readonly #viewport: () => TerminalViewport;

  constructor(input: {
    readonly write: (text: string) => void;
    readonly viewport: () => TerminalViewport;
  }) {
    this.#write = input.write;
    this.#viewport = input.viewport;
    this.#block = new TerminalBlock({ ...input, color: false });
  }

  draw(input: RunBlockInput): void {
    const capacity = Math.max(1, Math.floor(this.#viewport().rows) - 1);
    let lines = runBlockLines(input);
    for (let max = RUN_TREE_MAX_LINES - 1; lines.length > capacity && max >= 0; max -= 1) {
      lines = runBlockLines(input, max);
    }
    // Still too tall (many later traces): the frame shows the first lines only.
    this.#block.render({
      lines: lines.slice(0, capacity).map((text) => ({ text, tone: 'neutral' as const })),
    });
  }

  end(lines: readonly string[]): void {
    this.#block.render({ lines: [] });
    this.#block.finish();
    this.#write(`${lines.join('\n')}\n`);
  }
}
