import type { APIRequestContext } from '@playwright/test';

import type { BlackboxEntrypoint } from '../types.js';

function route(url: string, entrypoint: BlackboxEntrypoint | undefined): string {
  if (URL.canParse(url)) {
    return url;
  }
  if (entrypoint === undefined) { return url; }
  if (entrypoint.protocol !== 'http' && entrypoint.protocol !== 'https') {
    throw new Error('Relative Playwright requests require an HTTP sandbox entrypoint');
  }
  return new URL(url, `${entrypoint.url}/`).href;
}

/** Keep Playwright's context, options and lifecycle; resolve relative URLs inside this attempt. */
export function sandboxRequest(
  request: APIRequestContext,
  entrypoint: () => BlackboxEntrypoint | undefined,
): APIRequestContext {
  return new Proxy(request, {
    get(target, property) {
      switch (property) {
        case 'delete': return (url: string, options?: Parameters<APIRequestContext['delete']>[1]) =>
          target.delete(route(url, entrypoint()), options);
        case 'fetch': return (
          url: Parameters<APIRequestContext['fetch']>[0],
          options?: Parameters<APIRequestContext['fetch']>[1],
        ) => target.fetch(typeof url === 'string' ? route(url, entrypoint()) : url, options);
        case 'get': return (url: string, options?: Parameters<APIRequestContext['get']>[1]) =>
          target.get(route(url, entrypoint()), options);
        case 'head': return (url: string, options?: Parameters<APIRequestContext['head']>[1]) =>
          target.head(route(url, entrypoint()), options);
        case 'patch': return (url: string, options?: Parameters<APIRequestContext['patch']>[1]) =>
          target.patch(route(url, entrypoint()), options);
        case 'post': return (url: string, options?: Parameters<APIRequestContext['post']>[1]) =>
          target.post(route(url, entrypoint()), options);
        case 'put': return (url: string, options?: Parameters<APIRequestContext['put']>[1]) =>
          target.put(route(url, entrypoint()), options);
        default: {
          const value: unknown = Reflect.get(target, property);
          if (typeof value !== 'function') { return value; }
          return (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown;
        }
      }
    },
  });
}
