import type { APIRequestContext } from '@playwright/test';

import type { RequestEntry } from '../stimulus/summary.js';

interface SandboxRequestEntrypoint {
  readonly url: string;
  readonly protocol: string;
}

function route(url: string, entrypoint: SandboxRequestEntrypoint | undefined): string {
  if (URL.canParse(url)) {
    return url;
  }
  if (entrypoint === undefined) {
    return url;
  }
  if (entrypoint.protocol !== 'http' && entrypoint.protocol !== 'https') {
    throw new Error('Relative Playwright requests require an HTTP sandbox entrypoint');
  }
  return new URL(url, `${entrypoint.url}/`).href;
}

/** Receives what the test asked for; `opaque` marks a request object that cannot be summarized. */
export type RequestObserver = (entry: RequestEntry, opaque: boolean) => void;

const ignore: RequestObserver = () => undefined;

/** Keep Playwright's context, options and lifecycle; resolve relative URLs inside this attempt. */
export function sandboxRequest(
  request: APIRequestContext,
  entrypoint: () => SandboxRequestEntrypoint | undefined,
  observe: RequestObserver = ignore,
): APIRequestContext {
  const seen = (method: string, url: string, options: unknown): void => {
    observe({ method, url, options }, false);
  };
  return new Proxy(request, {
    get(target, property) {
      switch (property) {
        case 'delete':
          return (url: string, options?: Parameters<APIRequestContext['delete']>[1]) => {
            seen('DELETE', url, options);
            return target.delete(route(url, entrypoint()), options);
          };
        case 'fetch':
          return (
            url: Parameters<APIRequestContext['fetch']>[0],
            options?: Parameters<APIRequestContext['fetch']>[1],
          ) => {
            if (typeof url === 'string') {
              seen('GET', url, options);
            } else {
              observe({ method: 'GET', url: '', options }, true);
            }
            return target.fetch(typeof url === 'string' ? route(url, entrypoint()) : url, options);
          };
        case 'get':
          return (url: string, options?: Parameters<APIRequestContext['get']>[1]) => {
            seen('GET', url, options);
            return target.get(route(url, entrypoint()), options);
          };
        case 'head':
          return (url: string, options?: Parameters<APIRequestContext['head']>[1]) => {
            seen('HEAD', url, options);
            return target.head(route(url, entrypoint()), options);
          };
        case 'patch':
          return (url: string, options?: Parameters<APIRequestContext['patch']>[1]) => {
            seen('PATCH', url, options);
            return target.patch(route(url, entrypoint()), options);
          };
        case 'post':
          return (url: string, options?: Parameters<APIRequestContext['post']>[1]) => {
            seen('POST', url, options);
            return target.post(route(url, entrypoint()), options);
          };
        case 'put':
          return (url: string, options?: Parameters<APIRequestContext['put']>[1]) => {
            seen('PUT', url, options);
            return target.put(route(url, entrypoint()), options);
          };
        default: {
          const value: unknown = Reflect.get(target, property);
          if (typeof value !== 'function') {
            return value;
          }
          return (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown;
        }
      }
    },
  });
}
