import {
  readCapsuleActivities,
  readCapsuleLifecycle,
  type CapsuleActivityReport,
} from '@suites/blackbox-capsule';

import { ProjectIndex, type CapsuleSummary } from '../../context/project-index.js';
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
  /** The capsule as last read; its state feeds the 2a completeness function. */
  #capsule: CapsuleSummary;

  constructor(
    private readonly input: {
      readonly projectDirectory: string;
      readonly capsule: CapsuleSummary;
      readonly activityId: string;
    },
  ) {
    this.#capsule = input.capsule;
  }

  /**
   * Re-reads the capsule's state and reports whether it changed since the
   * last read (for example another process ran `capsule down` meanwhile).
   */
  async stateChanged(): Promise<boolean> {
    const before = this.#capsule.state;
    try {
      const summary = (await ProjectIndex.load(this.input.projectDirectory)).capsule(
        this.input.capsule.capsule,
      );
      if (summary !== null) {
        this.#capsule = summary;
      }
    } catch {
      // Keep the last state read.
    }
    return this.#capsule.state !== before;
  }

  /**
   * The collector's accepted-span total from its lifecycle record alone (no
   * fragment is read), or null when unreadable: what the wait polls.
   */
  async acceptedSpans(): Promise<number | null> {
    try {
      const result = await readCapsuleLifecycle({
        projectDirectory: this.input.projectDirectory,
        sessionId: this.input.capsule.capsule,
      });
      return result.kind === 'collector-lifecycle-found'
        ? result.lifecycle.telemetry.acceptedSpans
        : null;
    } catch {
      return null;
    }
  }

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
        capsule: this.#capsule,
        activities,
        session,
        traceIds: 'all',
      });
      return { activity, investigation: new CapsuleInvestigation(data) };
    } catch {
      const data = await loadInvestigation({
        projectDirectory: this.input.projectDirectory,
        capsule: this.#capsule,
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
