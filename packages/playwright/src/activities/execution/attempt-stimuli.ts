import {
  injectW3CTextMap,
  type W3CTraceContext,
  type TelemetryScopeResult,
} from '@suites/blackbox-telemetry';

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

const scopeContexts = new WeakMap<BlackboxStimulusScope, W3CTraceContext>();

export function stimulusHeaders(
  scope: BlackboxStimulusScope,
  carrier: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const context = scopeContexts.get(scope);
  if (context === undefined) {
    throw new Error('Unknown stimulus scope.');
  }
  // Native contexts merge default headers after per-call options. Empty state overrides
  // inherited tracestate when this freshly generated context has no vendor state.
  return { tracestate: '', ...injectW3CTextMap({ context, carrier }).values };
}

function stimulusScope(activity: OwnedActivity): BlackboxStimulusScope {
  const scope = Object.freeze({
    activityId: activity.activityId,
    headers: Object.freeze(injectW3CTextMap({ context: activity.context, carrier: {} }).values),
  });
  scopeContexts.set(scope, activity.context);
  return scope;
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
