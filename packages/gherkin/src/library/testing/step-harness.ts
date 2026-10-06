import { createStepRunner, type StepRunner } from '../../runtime/run-step.js';
import type { SandboxCredentials } from '../../runtime/credentials.js';
import type { BlackboxStep, StepArgument, StepFixtures } from '../../runtime/step-types.js';
import { library } from '../index.js';
import { STUB_TOKEN } from './stub-system.js';

// Runs library steps by their feature text through the real runtime path
// (resolve, then run), outside Playwright. The `request` fixture is a stand-in
// built on Node's fetch that implements only the APIRequestContext.fetch
// options the library uses and rejects any other, so a library change that
// relies on more of Playwright fails here instead of passing untested.

type RequestContext = NonNullable<StepFixtures['request']>;
type Sandbox = NonNullable<StepFixtures['sandbox']>;
type FetchOptions = Parameters<RequestContext['fetch']>[1];
type StepInfo = Parameters<Parameters<BlackboxStep>[1]>[0];

const SUPPORTED_OPTIONS = new Set(['method', 'headers', 'data', 'maxRedirects']);

function fetchRequest(): RequestContext {
  const fetchFromNode = async (url: string, options: FetchOptions = {}) => {
    const unsupported = Object.keys(options).filter((key) => !SUPPORTED_OPTIONS.has(key));
    if (unsupported.length > 0) {
      throw new Error(`stand-in request does not implement ${unsupported.join(', ')}`);
    }
    if (options.maxRedirects !== 0) {
      throw new Error('library requests must not follow redirects');
    }
    const data: unknown = options.data;
    if (data !== undefined && typeof data !== 'string') {
      throw new Error('library requests send JSON text');
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: data ?? null,
      redirect: 'manual',
    });
    const body = await response.text();
    return { status: () => response.status, text: () => Promise.resolve(body) };
  };
  // Only fetch exists; any other APIRequestContext member is a TypeError at the call site.
  return { fetch: fetchFromNode } as RequestContext;
}

export function sandboxAt(url: string): Sandbox {
  const parsed = new URL(url);
  return {
    sandboxId: 'stub-sandbox',
    executionId: 'stub-execution',
    catalogEntry: { id: 'subscription-system', kind: 'system' },
    projectName: 'stub',
    artifactDirectory: '/nonexistent',
    entrypoint: { url, host: parsed.hostname, port: Number(parsed.port), protocol: parsed.protocol },
    containers: new Map(),
  };
}

export function json(content: string): StepArgument {
  return { kind: 'doc-string', content, mediaType: 'json' };
}

export function table(rows: readonly (readonly string[])[]): StepArgument {
  return { kind: 'data-table', rows };
}

export const NONE = { kind: 'none' } as const satisfies StepArgument;

// Runs the step body directly; Playwright's step info is not used by the runner.
const plainStep: BlackboxStep = async (_title, body) => body({} as StepInfo);

export const runLibraryStep: StepRunner = createStepRunner(library, plainStep);

/** The Sandbox profile credentials of the stub: fixture-control presents the stub's token. */
export const STUB_CREDENTIALS = {
  'fixture-control': { scheme: 'bearer', token: STUB_TOKEN },
} as const satisfies SandboxCredentials;

/** One scenario attempt: fresh fixtures and world, steps run in order. */
export function scenarioAt(url: string, credentials: SandboxCredentials = STUB_CREDENTIALS) {
  const fixtures = {
    credentials,
    request: fetchRequest(),
    sandbox: sandboxAt(url),
    world: new Map(),
  } satisfies StepFixtures;
  const site = { feature: new URL('file:///qualification/library.feature'), line: 1, column: 1, keyword: 'Step' };
  return {
    fixtures,
    step: (text: string, argument: StepArgument = NONE): Promise<void> => runLibraryStep(fixtures, site, text, argument),
  };
}
