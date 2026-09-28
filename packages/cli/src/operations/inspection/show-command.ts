import {
  readCapsuleObservations,
  type CapsuleActivityReport,
  type CapsuleObservationsInput,
  type CapsuleObservationsResult,
} from '@suites/blackbox-capsule-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { PackageFailure } from '../../cli/failure.js';
import { capsuleFailure } from '../../capsule/capsule-output.js';
import { ActivityDisplay } from '../../context/display.js';
import { InvocationContext } from '../../context/invocation.js';
import type { ProjectIndex } from '../../context/project-index.js';
import { resolveId, type Resolved } from '../../context/resolver.js';
import { activityView, capsuleView, traceView } from './show-output.js';

export interface ShowRequest {
  readonly id: string;
  readonly capsuleFlag: string | null;
  readonly json: boolean;
}

function selection(resolved: Resolved): CapsuleObservationsInput['selection'] {
  switch (resolved.kind) {
    case 'capsule':
      return { kind: 'session' };
    case 'activity':
      return { kind: 'activity', activityId: resolved.activity.activityId };
    case 'trace':
      return { kind: 'trace', traceId: resolved.traceId };
  }
}

function latest(activities: readonly CapsuleActivityReport[]): CapsuleActivityReport | null {
  return activities.reduce<CapsuleActivityReport | null>(
    (found, activity) => (found === null || activity.sequence > found.sequence ? activity : found),
    null,
  );
}

/** `show` and its `observations` alias. Works on stopped capsules. */
export abstract class ShowCommand extends BlackboxCommand {
  protected async executeShow(request: ShowRequest): Promise<void> {
    const context = new InvocationContext(process.cwd());
    const index = await context.index();
    await this.requireExplicitCapsule(context, index, request.capsuleFlag);
    const resolved = await resolveId(index, request.id, context.scope(request.capsuleFlag));
    const capsule = resolved.capsule.capsule;
    const result = await readCapsuleObservations({
      projectDirectory: process.cwd(),
      sessionId: capsule,
      selection: selection(resolved),
    });
    if (
      result.kind === 'capsule-not-found' ||
      result.kind === 'capsule-invalid-state' ||
      result.kind === 'capsule-operation-failed'
    ) {
      throw new PackageFailure({ document: result, text: capsuleFailure({ result, json: false }) });
    }
    const view = await this.view(index, resolved, result);
    if (request.json) {
      this.json({ ...result, capsule, next: view.next });
    } else {
      this.human([...view.lines, ...view.next.map((command) => `→ ${command}`)]);
    }
    this.finish(EXIT_CODES.success);
  }

  /**
   * An explicit capsule context that the registry does not list is reported by
   * the Capsule package itself (capsule-not-found), as run and down do.
   */
  private async requireExplicitCapsule(
    context: InvocationContext,
    index: ProjectIndex,
    flag: string | null,
  ): Promise<void> {
    const explicit = context.explicit(flag);
    if (explicit === null || index.capsule(explicit.capsule) !== null) {
      return;
    }
    const result = await readCapsuleObservations({
      projectDirectory: process.cwd(),
      sessionId: explicit.capsule,
      selection: { kind: 'session' },
    });
    if (
      result.kind === 'capsule-not-found' ||
      result.kind === 'capsule-invalid-state' ||
      result.kind === 'capsule-operation-failed'
    ) {
      throw new PackageFailure({ document: result, text: capsuleFailure({ result, json: false }) });
    }
  }

  private async view(index: ProjectIndex, resolved: Resolved, result: CapsuleObservationsResult) {
    const display = new ActivityDisplay(
      (await index.allActivities()).map(({ activity }) => activity.activityId),
    );
    const activities = (await index.activities(resolved.capsule.capsule)) ?? [];
    switch (resolved.kind) {
      case 'activity':
        return activityView({
          short: display.short(resolved.activity.activityId),
          capsule: resolved.capsule,
          activity: resolved.activity,
          result,
        });
      case 'capsule': {
        const last = latest(activities);
        return capsuleView({
          capsule: resolved.capsule,
          activities,
          latest: last === null ? null : display.short(last.activityId),
          result,
        });
      }
      case 'trace': {
        const owner = activities.find(
          (activity) => activity.telemetry.context.traceId === resolved.traceId,
        );
        return traceView({
          traceId: resolved.traceId,
          capsule: resolved.capsule,
          associated: owner === undefined ? null : display.short(owner.activityId),
          result,
        });
      }
    }
  }
}
