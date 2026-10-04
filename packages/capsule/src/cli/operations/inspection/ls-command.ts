import type { CapsuleSessionState } from '@suites/blackbox-capsule';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { formatColumns } from '../../cli/output.js';
import { InvocationContext } from '../../context/invocation.js';
import {
  participantWarnings,
  type ParticipantWarnings,
} from '../lifecycle/participant-warnings.js';

const ACTIVE_STATES = new Set<CapsuleSessionState>([
  'admitted',
  'manager-starting',
  'sandbox-starting',
  'running',
  'stopping',
]);

export interface CapsuleRow {
  readonly capsule: string;
  readonly system: string;
  readonly state: CapsuleSessionState;
  readonly startedAt: string;
  readonly activities: number | null;
  readonly title: string;
}

/** The ls table: a two-character current marker, then content-sized columns. */
export function lsLines(input: {
  readonly rows: readonly CapsuleRow[];
  readonly current: string | null;
  readonly all: boolean;
}): readonly string[] {
  const header = ['CAPSULE', 'SYSTEM', 'STATE', 'STARTED', 'ACTIVITIES', 'TITLE'];
  const cells = input.rows.map((row) => [
    row.capsule,
    row.system,
    row.state,
    row.startedAt,
    row.activities === null ? '?' : String(row.activities),
    row.title,
  ]);
  const [head, ...body] = formatColumns([header, ...cells]);
  const marked = body.map(
    (line, index) => `${input.rows[index].capsule === input.current ? '*' : ' '} ${line}`,
  );
  if (marked.length === 0) {
    return [`  ${head}`, input.all ? 'no capsules' : 'no running capsules'];
  }
  return [`  ${head}`, ...marked];
}

/** Participant warnings for a running capsule; other states are not checked. */
async function runningWarnings(row: CapsuleRow): Promise<ParticipantWarnings> {
  return row.state === 'running' ? participantWarnings(row.capsule) : { lines: [], exited: [] };
}

/** `ls` and its `history` alias. Never needs a current capsule. */
export abstract class LsCommand extends BlackboxCommand {
  protected async executeLs(input: { readonly all: boolean; readonly json: boolean }) {
    const context = new InvocationContext(process.cwd());
    const index = await context.index();
    const current = await context.current();
    const summaries = index
      .capsules()
      .filter((summary) => input.all || ACTIVE_STATES.has(summary.state));
    const rows = await Promise.all(
      summaries.map(async (summary) => {
        const activities = await index.activities(summary.capsule);
        const row = {
          capsule: summary.capsule,
          system: summary.system,
          state: summary.state,
          startedAt: summary.startedAt,
          activities: activities === null ? null : activities.length,
          title: summary.title,
        } satisfies CapsuleRow;
        return { row, warnings: await runningWarnings(row) };
      }),
    );
    if (input.json) {
      this.json({
        kind: 'capsule-list',
        scope: input.all ? 'all' : 'active',
        current,
        capsules: rows.map(({ row, warnings }) =>
          warnings.exited.length === 0 ? row : { ...row, exitedParticipants: warnings.exited },
        ),
        next: [],
      });
    } else {
      this.human([
        ...lsLines({ rows: rows.map(({ row }) => row), current, all: input.all }),
        ...rows.flatMap(({ row, warnings }) =>
          warnings.lines.map((line) => `${line} in capsule ${row.capsule}`),
        ),
      ]);
    }
    this.finish(EXIT_CODES.success);
  }
}
