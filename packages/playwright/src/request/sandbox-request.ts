import type { APIRequestContext, APIResponse } from '@playwright/test';

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

type RequestOptions = Parameters<APIRequestContext['fetch']>[1];

export interface SandboxRequestDispatch {
  readonly url: string;
  readonly method: string;
  readonly options: RequestOptions;
  dispatch(options: RequestOptions): Promise<APIResponse>;
}

/** A neutral composition hook, invoked only for this sandbox's HTTP origin. */
export type SandboxRequestHook = (request: SandboxRequestDispatch) => Promise<APIResponse>;

function owns(url: string, entrypoint: SandboxRequestEntrypoint | undefined): boolean {
  return (
    entrypoint !== undefined &&
    (entrypoint.protocol === 'http' || entrypoint.protocol === 'https') &&
    URL.canParse(url) &&
    new URL(url).origin === new URL(entrypoint.url).origin
  );
}

/** Keep Playwright's context, options and lifecycle; resolve relative URLs inside this attempt. */
export function sandboxRequest(
  request: APIRequestContext,
  entrypoint: () => SandboxRequestEntrypoint | undefined,
  hook?: SandboxRequestHook,
): APIRequestContext {
  return new Proxy(request, {
    get(target, property) {
      if (['delete', 'fetch', 'get', 'head', 'patch', 'post', 'put'].includes(String(property))) {
        return (url: Parameters<APIRequestContext['fetch']>[0], options?: RequestOptions) => {
          const selected = entrypoint();
          const routed = typeof url === 'string' ? route(url, selected) : url;
          const method = Reflect.get(target, property) as APIRequestContext['fetch'];
          const dispatch = (nextOptions: RequestOptions): Promise<APIResponse> =>
            Reflect.apply(method, target, [routed, nextOptions]);
          if (hook === undefined || typeof routed !== 'string' || !owns(routed, selected)) {
            return dispatch(options);
          }
          return hook({
            url: routed,
            method:
              property === 'fetch'
                ? options === undefined
                  ? 'GET'
                  : (options.method ?? 'GET')
                : String(property).toUpperCase(),
            options,
            dispatch,
          });
        };
      }
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown;
    },
  });
}
