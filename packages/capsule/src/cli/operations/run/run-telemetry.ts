import { readCapsuleActivities, type CapsuleActivityReport } from '@suites/blackbox-capsule';

import type { CapsuleSummary } from '../../context/project-index.js';
import { loadInvestigation, readSession } from '../inspection/investigation-data.js';
import { CapsuleInvestigation } from '../inspection/investigation-model.js';

type Session = Awaited<ReturnType<typeof readSession>>;

/** What `run` shows for its activity: the activity record and its capsule's investigation. */
export interface RunSnapshot {
  readonly activity: CapsuleActivityReport;
  readonly investigation: CapsuleInvestigation;
}

/** The collector's accepted-span total, the wait's change signal. */
export function acceptedSpans(session: Session): number | null {
  return session !== null && session.kind === 'collector-session-found'
    ? session.lifecycle.telemetry.acceptedSpans
    : null;
}

/**
 * Reads the telemetry of one `run` activity through the 2a reads. Every read
 * is best effort: the child has already run, so a failed read shows less but
 * never changes the run's exit code.
 */
export class RunTelemetry {
  #activities: readonly CapsuleActivityReport[] | null = null;

  constructor(
    private readonly input: {
      readonly projectDirectory: string;
      readonly capsule: CapsuleSummary;
      readonly activityId: string;
    },
  ) {}

  /** The capsule's session read (lifecycle, trace IDs), or null when unreadable. */
  async session(): Promise<Session> {
    try {
      return await readSession({
        projectDirectory: this.input.projectDirectory,
        capsule: this.input.capsule.capsule,
      });
    } catch {
      return null;
    }
  }

  /**
   * The activity and the capsule's traces as `session` lists them, or null
   * when the activity record cannot be read. Activities are re-read each time
   * so causality sees every activity that started meanwhile.
   */
  async snapshot(session: Session): Promise<RunSnapshot | null> {
    const activities = await this.#readActivities();
    if (activities === null) {
      return null;
    }
    const activity = activities.find((candidate) => candidate.activityId === this.input.activityId);
    if (activity === undefined) {
      return null;
    }
    try {
      const data = await loadInvestigation({
        projectDirectory: this.input.projectDirectory,
        capsule: this.input.capsule,
        activities,
        session,
        traceIds: 'all',
      });
      return { activity, investigation: new CapsuleInvestigation(data) };
    } catch {
      const data = await loadInvestigation({
        projectDirectory: this.input.projectDirectory,
        capsule: this.input.capsule,
        activities,
        session: null,
        traceIds: [],
      });
      return { activity, investigation: new CapsuleInvestigation(data) };
    }
  }

  async #readActivities(): Promise<readonly CapsuleActivityReport[] | null> {
    try {
      this.#activities = await readCapsuleActivities({
        projectDirectory: this.input.projectDirectory,
        sessionId: this.input.capsule.capsule,
      });
    } catch {
      // Keep the last list read; the activity itself does not change.
    }
    return this.#activities;
  }
}
