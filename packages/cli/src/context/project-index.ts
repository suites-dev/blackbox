import {
  listCapsuleSessions,
  readCapsuleActivities,
  readCapsuleObservations,
  type CapsuleActivityReport,
  type CapsuleSessionState,
} from '@suites/blackbox-capsule-internal';

import { PackageFailure, cliFailure } from '../cli/failure.js';
import { capsuleFailure } from '../capsule/capsule-output.js';
import { isCapsuleIdShape } from './identifiers.js';

/** The Capsule package operation a missing explicit capsule is reported for. */
export type CapsuleOperation = 'exec' | 'stop' | 'report' | 'observations';

interface RecordedError {
  readonly name: string;
  readonly message: string;
}

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
  readonly #corrupt: ReadonlyMap<string, RecordedError>;
  readonly #activities = new Map<string, Promise<readonly CapsuleActivityReport[] | null>>();
  readonly #traces = new Map<string, Promise<readonly string[]>>();

  private constructor(
    projectDirectory: string,
    capsules: readonly CapsuleSummary[],
    corrupt: ReadonlyMap<string, RecordedError>,
  ) {
    this.projectDirectory = projectDirectory;
    this.#capsules = capsules;
    this.#corrupt = corrupt;
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
    const corrupt = new Map<string, RecordedError>();
    for (const entry of result.entries) {
      if (entry.kind === 'capsule-session-corrupt' && entry.directoryName.startsWith('capsule-')) {
        corrupt.set(
          entry.directoryName.slice('capsule-'.length),
          entry.failure.kind === 'identity-mismatch'
            ? {
                name: 'CapsuleIdentityMismatch',
                message: `Capsule directory ${entry.directoryName} holds session ${entry.failure.recordSessionId}`,
              }
            : entry.failure.error,
        );
      }
    }
    return new ProjectIndex(result.projectDirectory, capsules, corrupt);
  }

  /**
   * The failure for an explicit capsule ID (flag or BLACKBOX_CAPSULE) that the
   * registry does not list. It reproduces the Capsule package's own document for
   * that input without passing the raw value to any file-system operation.
   */
  missingCapsule(id: string, operation: CapsuleOperation): PackageFailure {
    const recorded = isCapsuleIdShape(id)
      ? (this.#corrupt.get(id) ?? null)
      : { name: 'Error', message: 'sessionId must be an exact Capsule-generated identity' };
    const result =
      recorded === null
        ? {
            kind: 'capsule-not-found' as const,
            sessionId: id,
            message: `Capsule session ${id} does not exist`,
          }
        : {
            kind: 'capsule-operation-failed' as const,
            operation,
            sessionId: id,
            error: recorded,
          };
    return new PackageFailure({
      document: { ...result, capsule: id, next: ['blackbox ls --all'] },
      text: capsuleFailure({ result, json: false }),
    });
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
