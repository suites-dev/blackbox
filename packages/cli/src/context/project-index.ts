import {
  listCapsuleSessions,
  readCapsuleActivities,
  readCapsuleObservations,
  type CapsuleActivityReport,
  type CapsuleSessionState,
} from '@suites/blackbox-capsule-internal';

import { cliFailure } from '../cli/failure.js';

export interface CapsuleSummary {
  readonly capsule: string;
  readonly system: string;
  readonly title: string;
  readonly state: CapsuleSessionState;
  readonly startedAt: string;
}

export interface ActivityEntry {
  readonly capsule: string;
  readonly activity: CapsuleActivityReport;
}

export function activityName(activity: CapsuleActivityReport): string | null {
  return activity.name.kind === 'provided' ? activity.name.value : null;
}

/**
 * A read-only, lazily loaded view of every retained capsule in one project,
 * built only on existing Capsule package read APIs. Unreadable registry
 * entries are skipped; an unreadable registry is a package failure.
 */
export class ProjectIndex {
  readonly projectDirectory: string;
  readonly #capsules: readonly CapsuleSummary[];
  readonly #activities = new Map<string, Promise<readonly CapsuleActivityReport[] | null>>();
  readonly #traces = new Map<string, Promise<readonly string[]>>();

  private constructor(projectDirectory: string, capsules: readonly CapsuleSummary[]) {
    this.projectDirectory = projectDirectory;
    this.#capsules = capsules;
  }

  static async load(projectDirectory: string): Promise<ProjectIndex> {
    const result = await listCapsuleSessions({ projectDirectory });
    if (result.kind === 'capsule-registry-failed') {
      // ls, use and open report every failure as a cli-error (table D).
      throw cliFailure('operation-failed', `${result.error.name}: ${result.error.message}`);
    }
    const capsules = result.entries.flatMap((entry) =>
      entry.kind === 'capsule-session-summary'
        ? [
            {
              capsule: entry.summary.sessionId,
              system: entry.summary.system,
              title: entry.summary.title,
              state: entry.summary.state,
              startedAt: entry.summary.admittedAt,
            },
          ]
        : [],
    );
    return new ProjectIndex(result.projectDirectory, capsules);
  }

  /** Newest first, as the registry orders them. */
  capsules(): readonly CapsuleSummary[] {
    return this.#capsules;
  }

  capsule(id: string): CapsuleSummary | null {
    return this.#capsules.find((candidate) => candidate.capsule === id) ?? null;
  }

  activities(capsule: string): Promise<readonly CapsuleActivityReport[] | null> {
    let pending = this.#activities.get(capsule);
    if (pending === undefined) {
      pending = readCapsuleActivities({
        projectDirectory: this.projectDirectory,
        sessionId: capsule,
      }).catch(() => null);
      this.#activities.set(capsule, pending);
    }
    return pending;
  }

  async allActivities(): Promise<readonly ActivityEntry[]> {
    const lists = await Promise.all(
      this.#capsules.map(async ({ capsule }) =>
        ((await this.activities(capsule)) ?? []).map((activity) => ({ capsule, activity })),
      ),
    );
    return lists.flat();
  }

  /** Trace IDs retained for a capsule: collector traces plus each activity's own trace. */
  traces(capsule: string): Promise<readonly string[]> {
    let pending = this.#traces.get(capsule);
    if (pending === undefined) {
      pending = this.#readTraces(capsule);
      this.#traces.set(capsule, pending);
    }
    return pending;
  }

  async #readTraces(capsule: string): Promise<readonly string[]> {
    const [observations, activities] = await Promise.all([
      readCapsuleObservations({
        projectDirectory: this.projectDirectory,
        sessionId: capsule,
        selection: { kind: 'session' },
      }).catch(() => null),
      this.activities(capsule),
    ]);
    const collected =
      observations !== null && observations.kind === 'collector-session-found'
        ? observations.traceIds
        : [];
    const own = (activities ?? []).map((activity) => activity.telemetry.context.traceId);
    return [...new Set([...collected, ...own])];
  }
}
