import type { APIRequestContext, TestInfo } from '@playwright/test';

import { recordStimulusRequest } from '../effects/attempt-effects.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { hasUnrecordedDefaults, withDefaultHeaders } from './inherited.js';
import { sandboxRequest } from './sandbox-request.js';

export function requestFixtureFor(activeAttempts: WeakMap<TestInfo, RunningBlackboxAttempt>) {
  return async (
    {
      request,
      extraHTTPHeaders,
      httpCredentials,
      storageState,
    }: {
      readonly request: APIRequestContext;
      readonly extraHTTPHeaders: unknown;
      readonly httpCredentials: unknown;
      readonly storageState: unknown;
    },
    use: (request: APIRequestContext) => Promise<void>,
    testInfo: TestInfo,
  ): Promise<void> => {
    const defaults = { extraHTTPHeaders, httpCredentials, storageState };
    await use(
      sandboxRequest(
        request,
        () => {
          const attempt = activeAttempts.get(testInfo);
          return attempt === undefined ? undefined : attempt.sandbox.entrypoint;
        },
        (entry, opaque) => {
          const attempt = activeAttempts.get(testInfo);
          if (attempt !== undefined) {
            recordStimulusRequest(attempt.effects, {
              entry: withDefaultHeaders(entry, defaults),
              entrypointUrl: attempt.sandbox.entrypoint.url,
              opaque: opaque || hasUnrecordedDefaults(defaults),
            });
          }
        },
      ),
    );
  };
}
