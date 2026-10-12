import { injectW3CTextMap, type TelemetryScopeResult } from '@suites/blackbox-telemetry';

import { createActivityRegistry } from '../activity-registry.js';
import type { ActivitySelection, OwnedActivity } from '../types.js';
import type { BlackboxStimulusScope } from '../../steps/types.js';

export type CompletedStimuli =
  { readonly kind: 'none' } | { readonly kind: 'selected'; readonly selection: ActivitySelection };

function failure(error: unknown): TelemetryScopeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: 'telemetry-scope-failed',
    message: message.trim() === '' ? 'Stimulus failed.' : message,
  };
}

function stimulusScope(activity: OwnedActivity): BlackboxStimulusScope {
  return Object.freeze({
    activityId: activity.activityId,
    headers: Object.freeze(injectW3CTextMap({ context: activity.context, carrier: {} }).values),
  });
}

/** Attempt-owned stimulus traces used to select effects; not a test fixture. */
export class AttemptStimuli {
  readonly #registry: ReturnType<typeof createActivityRegistry>;
  readonly #completed: OwnedActivity[] = [];
  #active = true;

  constructor(input: { readonly sessionId: string; readonly executionId: string }) {
    this.#registry = createActivityRegistry(input);
  }

  close(): void {
    this.#active = false;
  }

  async run<T>(name: string, action: (scope: BlackboxStimulusScope) => T | Promise<T>): Promise<T> {
    if (!this.#active) {
      throw new Error(
        'This Blackbox attempt has expired. Stimulus execution is no longer available.',
      );
    }
    const activity = this.#registry.begin({ purpose: 'stimulus', name });
    try {
      const result = await action(stimulusScope(activity));
      this.#finish(activity, { kind: 'telemetry-scope-succeeded' });
      return result;
    } catch (error) {
      this.#finish(activity, failure(error));
      throw error;
    }
  }

  completed(): CompletedStimuli {
    if (this.#completed.length === 0) {
      return { kind: 'none' };
    }
    return {
      kind: 'selected',
      selection: this.#registry.select({
        kind: 'stimulus',
        activities: [...this.#completed],
      }),
    };
  }

  #finish(activity: OwnedActivity, outcome: TelemetryScopeResult): void {
    this.#registry.finish(activity, outcome);
    this.#completed.push(activity);
  }
}
