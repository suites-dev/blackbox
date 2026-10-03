import type { Page, Request, Route } from '@playwright/test';
import { injectW3CTextMap, type TelemetryScopeResult } from '@suites/blackbox-telemetry';

import { createActivityRegistry } from '../activities/activity-registry.js';
import type {
  BlackboxActivities,
  BlackboxActivityActions,
  BlackboxActivityContext,
  BlackboxScopedRequest,
} from '../activities/public-types.js';
import type { ActivityPurpose, OwnedActivity } from '../activities/types.js';
import {
  evaluateBlackboxEffects,
  createBlackboxEffects,
  markBlackboxEffectsLive,
} from './runtime.js';
import { createScopedBlackboxEffects } from './scoped-effects.js';

function failure(error: unknown): TelemetryScopeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: 'telemetry-scope-failed',
    message: message.trim() === '' ? 'Activity failed.' : message,
  };
}

function scopedRequest(
  request: BlackboxScopedRequest,
  headers: Readonly<Record<string, string>>,
): BlackboxScopedRequest {
  const withHeaders = <T extends object>(options: T | undefined): T => {
    const existing = options ?? {};
    const prior =
      'headers' in existing && typeof existing.headers === 'object' && existing.headers !== null
        ? existing.headers
        : {};
    return { ...existing, headers: { ...prior, ...headers } } as T;
  };
  return Object.freeze({
    delete: (url, options) => request.delete(url, withHeaders(options)),
    fetch: (urlOrRequest, options) => request.fetch(urlOrRequest, withHeaders(options)),
    get: (url, options) => request.get(url, withHeaders(options)),
    head: (url, options) => request.head(url, withHeaders(options)),
    patch: (url, options) => request.patch(url, withHeaders(options)),
    post: (url, options) => request.post(url, withHeaders(options)),
    put: (url, options) => request.put(url, withHeaders(options)),
  });
}

function canonicalHeaders(activity: OwnedActivity): Readonly<Record<string, string>> {
  return Object.freeze(injectW3CTextMap({ context: activity.context, carrier: {} }).values);
}

async function browserAction<T>(input: {
  readonly page: Page;
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly action: (page: Page) => Promise<T>;
}): Promise<T> {
  const matches = (url: URL) => url.origin === input.origin;
  const handler = async (route: Route, request: Request): Promise<void> => {
    await route.continue({ headers: { ...request.headers(), ...input.headers } });
  };
  await input.page.route(matches, handler);
  try {
    return await input.action(input.page);
  } finally {
    await input.page.unroute(matches, handler);
  }
}

export function createAttemptEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly storageDirectory: string;
  readonly entrypointUrl: string;
}): {
  readonly effects: ReturnType<typeof createBlackboxEffects>;
  readonly activities: BlackboxActivities;
} {
  const registry = createActivityRegistry(input);
  const completedStimuli: OwnedActivity[] = [];
  const origin = new URL(input.entrypointUrl).origin;

  async function run<T>(
    purpose: ActivityPurpose,
    name: string,
    action: (context: BlackboxActivityContext) => Promise<T>,
  ): Promise<T> {
    const activity = registry.begin({ purpose, name });
    const context = Object.freeze({
      activityId: activity.activityId,
      headers: canonicalHeaders(activity),
    });
    try {
      const value = await action(context);
      registry.finish(activity, { kind: 'telemetry-scope-succeeded' });
      if (purpose === 'stimulus') {
        completedStimuli.push(activity);
      }
      return value;
    } catch (error) {
      registry.finish(activity, failure(error));
      if (purpose === 'stimulus') {
        completedStimuli.push(activity);
      }
      throw error;
    }
  }

  function actions(purpose: ActivityPurpose): BlackboxActivityActions {
    return Object.freeze({
      run: <T>(name: string, action: (context: BlackboxActivityContext) => Promise<T>) =>
        run(purpose, name, action),
      request: <T>(
        name: string,
        request: BlackboxScopedRequest,
        action: (request: BlackboxScopedRequest) => Promise<T>,
      ) => run(purpose, name, ({ headers }) => action(scopedRequest(request, headers))),
      browser: <T>(name: string, page: Page, action: (page: Page) => Promise<T>) =>
        run(purpose, name, ({ headers }) => browserAction({ page, origin, headers, action })),
    });
  }

  const effects = createBlackboxEffects({
    sessionId: input.sessionId,
    executionId: input.executionId,
    evaluator: {
      async evaluate(contract) {
        if (completedStimuli.length === 0) {
          return {
            kind: 'inconclusive',
            message: 'No completed stimulus activity is available for this Playwright attempt.',
          };
        }
        const selected = createScopedBlackboxEffects({
          storageDirectory: input.storageDirectory,
          selection: registry.select({ kind: 'stimulus', activities: [...completedStimuli] }),
        });
        return evaluateBlackboxEffects(selected, contract);
      },
    },
  });
  markBlackboxEffectsLive(effects);
  return {
    effects,
    activities: Object.freeze({
      setup: actions('setup'),
      stimulus: actions('stimulus'),
      inspection: actions('inspection'),
    }),
  };
}

export function createUnavailableBlackboxActivities(): BlackboxActivities {
  const unavailable = (): never => {
    throw new Error('The configured Blackbox runtime does not provide activity execution.');
  };
  const actions = Object.freeze({
    run: unavailable,
    request: unavailable,
    browser: unavailable,
  }) as BlackboxActivityActions;
  return Object.freeze({ setup: actions, stimulus: actions, inspection: actions });
}
