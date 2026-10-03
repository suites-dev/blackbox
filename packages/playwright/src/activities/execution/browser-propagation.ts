import type { APIResponse, Page, Request, Route } from '@playwright/test';

import { mergeActivityHeaders, removeInjectedActivityHeaders } from './propagation.js';

const activePages = new WeakSet<Page>();
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function redirects(response: APIResponse): boolean {
  return (
    redirectStatuses.has(response.status()) &&
    response.headersArray().some((header) => header.name.toLowerCase() === 'location')
  );
}

async function propagateRoute(input: {
  readonly route: Route;
  readonly request: Request;
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rejectBoundary: (error: Error) => void;
}): Promise<void> {
  const requestUrl = input.request.url();
  if (new URL(requestUrl).origin !== input.origin) {
    await input.route.continue({
      headers: removeInjectedActivityHeaders(input.request.headers(), input.headers),
    });
    return;
  }
  try {
    // Do not let the route-owned fetch follow redirects. Playwright does not re-intercept the
    // browser's follow-up request, so no public API can preserve this scoped boundary natively.
    const response = await input.route.fetch({
      headers: mergeActivityHeaders(input.request.headers(), input.headers),
      maxRedirects: 0,
    });
    if (redirects(response)) {
      const error = new Error(
        'Blackbox browser activity cannot follow redirects safely. For a same-origin destination, navigate to its final URL directly in a new scoped action.',
      );
      input.rejectBoundary(error);
      await input.route.abort('blockedbyclient');
      return;
    }
    await input.route.fulfill({ response });
  } catch (error) {
    input.rejectBoundary(error instanceof Error ? error : new Error(String(error)));
    await input.route.abort('failed');
  }
}

export async function runBrowserActivity<T>(input: {
  readonly page: Page;
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly action: (page: Page) => Promise<T>;
}): Promise<T> {
  if (activePages.has(input.page)) {
    throw new Error(
      'Overlapping or nested Blackbox browser activities on the same Page are not supported.',
    );
  }
  activePages.add(input.page);
  const matches = (): boolean => true;
  let rejectBoundary = (_error: Error): void => undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const handler = (route: Route, request: Request): Promise<void> =>
    propagateRoute({ ...input, route, request, rejectBoundary });
  let installed = false;
  try {
    await input.page.route(matches, handler);
    installed = true;
    return await Promise.race([input.action(input.page), boundary]);
  } finally {
    try {
      if (installed) {
        await input.page.unroute(matches, handler);
      }
    } finally {
      activePages.delete(input.page);
    }
  }
}
