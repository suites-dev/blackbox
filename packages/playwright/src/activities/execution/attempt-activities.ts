import type { Page } from '@playwright/test';
import { injectW3CTextMap, type TelemetryScopeResult } from '@suites/blackbox-telemetry';

import { createActivityRegistry } from '../activity-registry.js';
import { runBrowserActivity } from './browser-propagation.js';
import { mergeActivityHeaders } from './propagation.js';
import type {
  BlackboxActivities,
  BlackboxActivityActions,
  BlackboxActivityContext,
  BlackboxScopedRequest,
} from '../public-types.js';
import type { ActivityPurpose, ActivitySelection, OwnedActivity } from '../types.js';

export type CompletedStimuli =
  { readonly kind: 'none' } | { readonly kind: 'selected'; readonly selection: ActivitySelection };

function failure(error: unknown): TelemetryScopeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: 'telemetry-scope-failed',
    message: message.trim() === '' ? 'Activity failed.' : message,
  };
}

function canonicalHeaders(activity: OwnedActivity): Readonly<Record<string, string>> {
  return Object.freeze(injectW3CTextMap({ context: activity.context, carrier: {} }).values);
}

function scopedRequest(
  request: BlackboxScopedRequest,
  headers: Readonly<Record<string, string>>,
  assertAvailable: () => void,
): BlackboxScopedRequest {
  const withHeaders = <T extends object>(options: T | undefined): T => {
    const existing = options ?? {};
    const prior =
      'headers' in existing && typeof existing.headers === 'object' && existing.headers !== null
        ? (existing.headers as Readonly<Record<string, string>>)
        : {};
    return { ...existing, headers: mergeActivityHeaders(prior, headers) } as T;
  };
  const call = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      assertAvailable();
      return operation();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  return Object.freeze({
    delete: (url, options) => call(() => request.delete(url, withHeaders(options))),
    fetch: (urlOrRequest, options) => call(() => request.fetch(urlOrRequest, withHeaders(options))),
    get: (url, options) => call(() => request.get(url, withHeaders(options))),
    head: (url, options) => call(() => request.head(url, withHeaders(options))),
    patch: (url, options) => call(() => request.patch(url, withHeaders(options))),
    post: (url, options) => call(() => request.post(url, withHeaders(options))),
    put: (url, options) => call(() => request.put(url, withHeaders(options))),
  });
}

export class AttemptActivities {
  readonly activities: BlackboxActivities;
  readonly #registry: ReturnType<typeof createActivityRegistry>;
  readonly #completedStimuli: OwnedActivity[] = [];
  readonly #origin: string;
  #active = true;

  constructor(input: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly entrypointUrl: string;
  }) {
    this.#registry = createActivityRegistry(input);
    this.#origin = new URL(input.entrypointUrl).origin;
    this.activities = Object.freeze({
      setup: this.#actions('setup'),
      stimulus: this.#actions('stimulus'),
      inspection: this.#actions('inspection'),
    });
  }

  close(): void {
    this.#active = false;
  }

  completedStimuli(): CompletedStimuli {
    if (this.#completedStimuli.length === 0) {
      return { kind: 'none' };
    }
    return {
      kind: 'selected',
      selection: this.#registry.select({
        kind: 'stimulus',
        activities: [...this.#completedStimuli],
      }),
    };
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error(
        'This Blackbox attempt has expired. Activity execution is no longer available.',
      );
    }
  }

  async #run<T>(
    purpose: ActivityPurpose,
    name: string,
    action: (context: BlackboxActivityContext) => Promise<T>,
  ): Promise<T> {
    this.#assertActive();
    const activity = this.#registry.begin({ purpose, name });
    const context = Object.freeze({
      activityId: activity.activityId,
      headers: canonicalHeaders(activity),
    });
    try {
      const value = await action(context);
      this.#finish(activity, purpose, { kind: 'telemetry-scope-succeeded' });
      return value;
    } catch (error) {
      this.#finish(activity, purpose, failure(error));
      throw error;
    }
  }

  #finish(activity: OwnedActivity, purpose: ActivityPurpose, result: TelemetryScopeResult): void {
    this.#registry.finish(activity, result);
    if (purpose === 'stimulus') {
      this.#completedStimuli.push(activity);
    }
  }

  async #request<T>(input: {
    readonly request: BlackboxScopedRequest;
    readonly headers: Readonly<Record<string, string>>;
    readonly action: (request: BlackboxScopedRequest) => Promise<T>;
  }): Promise<T> {
    let available = true;
    const assertAvailable = (): void => {
      this.#assertActive();
      if (!available) {
        throw new Error('This scoped request is no longer available after its activity ended.');
      }
    };
    const scoped = scopedRequest(input.request, input.headers, assertAvailable);
    try {
      return await input.action(scoped);
    } finally {
      available = false;
    }
  }

  #actions(purpose: ActivityPurpose): BlackboxActivityActions {
    return Object.freeze({
      run: <T>(name: string, action: (context: BlackboxActivityContext) => Promise<T>) =>
        this.#run(purpose, name, action),
      request: <T>(
        name: string,
        request: BlackboxScopedRequest,
        action: (request: BlackboxScopedRequest) => Promise<T>,
      ) => this.#run(purpose, name, ({ headers }) => this.#request({ request, headers, action })),
      browser: <T>(name: string, page: Page, action: (page: Page) => Promise<T>) =>
        this.#run(purpose, name, ({ headers }) =>
          runBrowserActivity({ page, origin: this.#origin, headers, action }),
        ),
    });
  }
}
