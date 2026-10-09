import type { APIResponse, Page, Request, Route } from '@playwright/test';

type RouteHandler = Parameters<Page['route']>[1];
type RouteMatcher = Parameters<Page['route']>[0];

export interface RouteEvent {
  readonly kind: 'fetch' | 'continue' | 'fulfill' | 'abort';
  readonly headers: Readonly<Record<string, string>>;
  readonly reason: string;
}

export interface MockPage {
  readonly page: Page;
  readonly registrations: readonly RouteMatcher[];
  readonly unregistrations: readonly RouteMatcher[];
  readonly events: readonly RouteEvent[];
  invoke(url: string, headers: Readonly<Record<string, string>>): Promise<void>;
}

function fakeResponse(): APIResponse {
  const response = Object.create(null) as APIResponse;
  Object.defineProperties(response, {
    status: { value: () => 200 },
    headers: { value: () => ({}) },
    headersArray: { value: () => [] },
  });
  return response;
}

function fakeRequest(url: string, headers: Readonly<Record<string, string>>): Request {
  const request = Object.create(null) as Request;
  Object.defineProperties(request, {
    url: { value: () => url },
    headers: { value: () => headers },
  });
  return request;
}

export function createMockPage(): MockPage {
  const registrations: RouteMatcher[] = [];
  const unregistrations: RouteMatcher[] = [];
  const events: RouteEvent[] = [];
  let handler: RouteHandler | undefined;
  const page = Object.create(null) as Page;
  Object.defineProperties(page, {
    route: {
      value: (matcher: RouteMatcher, candidate: RouteHandler) => {
        registrations.push(matcher);
        handler = candidate;
        return Promise.resolve();
      },
    },
    unroute: {
      value: (matcher: RouteMatcher, candidate: RouteHandler) => {
        if (candidate !== handler) {
          throw new Error('Browser activity did not remove its exact route handler.');
        }
        unregistrations.push(matcher);
        handler = undefined;
        return Promise.resolve();
      },
    },
  });
  return Object.freeze({
    page,
    registrations,
    unregistrations,
    events,
    invoke: async (url: string, headers: Readonly<Record<string, string>>) => {
      if (handler === undefined) {
        throw new Error('No browser activity route handler is installed.');
      }
      const route = Object.create(null) as Route;
      Object.defineProperties(route, {
        fetch: {
          value: (options: { readonly headers: Readonly<Record<string, string>> }) => {
            events.push({ kind: 'fetch', headers: options.headers, reason: '' });
            return Promise.resolve(fakeResponse());
          },
        },
        continue: {
          value: (options: { readonly headers: Readonly<Record<string, string>> }) => {
            events.push({ kind: 'continue', headers: options.headers, reason: '' });
            return Promise.resolve();
          },
        },
        fulfill: {
          value: () => {
            events.push({ kind: 'fulfill', headers: {}, reason: '' });
            return Promise.resolve();
          },
        },
        abort: {
          value: (reason: string) => {
            events.push({ kind: 'abort', headers: {}, reason });
            return Promise.resolve();
          },
        },
      });
      await handler(route, fakeRequest(url, headers));
    },
  });
}
