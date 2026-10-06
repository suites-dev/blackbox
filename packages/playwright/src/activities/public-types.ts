import type { APIRequestContext } from '@playwright/test';

export type BlackboxScopedRequest = Readonly<
  Pick<APIRequestContext, 'delete' | 'fetch' | 'get' | 'head' | 'patch' | 'post' | 'put'>
>;

export interface BlackboxActivityContext {
  readonly activityId: string;
  /** Canonical W3C headers for a custom transport action. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface BlackboxActivityActions {
  /** Run a custom action inside one explicitly propagated activity. */
  run<T>(name: string, action: (context: BlackboxActivityContext) => Promise<T>): Promise<T>;
  /** Run one or more direct Playwright HTTP calls with canonical propagation. */
  request<T>(
    name: string,
    request: BlackboxScopedRequest,
    action: (request: BlackboxScopedRequest) => Promise<T>,
  ): Promise<T>;
}

export interface BlackboxActivities {
  readonly setup: BlackboxActivityActions;
  readonly stimulus: BlackboxActivityActions;
  readonly inspection: BlackboxActivityActions;
}
