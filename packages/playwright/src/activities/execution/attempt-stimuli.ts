import { AsyncLocalStorage } from 'node:async_hooks';

import { injectW3CTextMap, type TelemetryScopeResult } from '@suites/blackbox-telemetry';

import { createActivityRegistry } from '../activity-registry.js';
import { activityAdmissionLimits } from '../limits.js';
import type { ActivitySelection, OwnedActivity } from '../types.js';
import type { BlackboxStimulusScope } from '../../steps/types.js';
import {
  summarizeRequest,
  type RecordedRequest,
  type RecordedStimulus,
  type RequestEntry,
} from '../../stimulus/summary.js';

export type CompletedStimuli =
  | { readonly kind: 'none' }
  | { readonly kind: 'selected'; readonly selection: ActivitySelection }
  | { readonly kind: 'partial'; readonly message: string; readonly omitted: number; readonly selection: ActivitySelection; readonly activities: readonly { readonly activityId: string; readonly purpose: 'stimulus' }[] };

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
  readonly #current = new AsyncLocalStorage<number>();
  readonly #stimuli: { title: string; requests: RecordedRequest[] }[] = [];
  #unscoped = 0;
  #opaque = 0;
  #running = 0;
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
    const slot = this.#stimuli.push({ title: name, requests: [] }) - 1;
    // Requests are listed per scope, so the order between scopes that overlap cannot be represented.
    this.#opaque += this.#running > 0 ? 1 : 0;
    this.#running++;
    try {
      const result = await this.#current.run(slot, () => action(stimulusScope(activity)));
      this.#finish(activity, { kind: 'telemetry-scope-succeeded' });
      return result;
    } catch (error) {
      this.#finish(activity, failure(error));
      throw error;
    } finally {
      this.#running--;
    }
  }

  /** Called by the request fixture for every request the test makes; attributed to the running stimulus. */
  record(entry: RequestEntry, entrypointUrl: string | null, opaque: boolean): void {
    const slot = this.#current.getStore();
    if (opaque) {
      this.#opaque++;
    } else if (slot === undefined) {
      this.#unscoped++;
    } else {
      const summary = summarizeRequest(entry, entrypointUrl);
      if (summary === null) {
        this.#opaque++;
      } else {
        this.#stimuli[slot].requests.push(summary);
      }
    }
  }

  recorded(): {
    readonly stimuli: readonly RecordedStimulus[];
    readonly unscoped: number;
    readonly opaque: number;
  } {
    return { stimuli: this.#stimuli, unscoped: this.#unscoped, opaque: this.#opaque };
  }

  completed(): CompletedStimuli {
    if (this.#completed.length === 0) {
      return { kind: 'none' };
    }
    if (this.#completed.length > activityAdmissionLimits.selectedTraces) {
      return { kind: 'partial', message: 'Final activity selection omits earlier activities',
        omitted: this.#completed.length - activityAdmissionLimits.selectedTraces,
        selection: this.#registry.select({ kind: 'stimulus', activities: this.#completed.slice(-activityAdmissionLimits.selectedTraces) }),
        activities: this.#completed.map(({ activityId }) => ({ activityId, purpose: 'stimulus' as const })) };
    }
    return {
      kind: 'selected',
      selection: this.#registry.select({
        kind: 'stimulus',
        activities: [...this.#completed],
      }),
    };
  }

  /** Select one completed activity without admitting other stimuli from this attempt. */
  completedActivity(activityId: string): CompletedStimuli {
    const activity = this.#completed.find((candidate) => candidate.activityId === activityId);
    return activity === undefined
      ? { kind: 'none' }
      : {
          kind: 'selected',
          selection: this.#registry.select({ kind: 'stimulus', activities: [activity] }),
        };
  }

  #finish(activity: OwnedActivity, outcome: TelemetryScopeResult): void {
    this.#registry.finish(activity, outcome);
    this.#completed.push(activity);
  }
}
