import type { APIRequestContext, Page } from '@playwright/test';

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
  /**
   * Run same-origin browser traffic with canonical propagation on the supplied page.
   * Redirects are rejected before the follow-up request because Playwright cannot preserve the
   * activity boundary across native redirect handling. Navigate directly or split the navigation.
   * Concurrent or nested activities on one Page are rejected; separate pages remain independent.
   * Requests owned by a service worker cannot be intercepted, so use a context with service workers blocked.
   */
  browser<T>(name: string, page: Page, action: (page: Page) => Promise<T>): Promise<T>;
}

export interface BlackboxActivities {
  readonly setup: BlackboxActivityActions;
  readonly stimulus: BlackboxActivityActions;
  readonly inspection: BlackboxActivityActions;
}
