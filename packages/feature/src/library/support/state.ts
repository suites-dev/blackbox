import { expect } from '@suites/blackbox-playwright';

import type { SandboxCredentials } from '../../runtime/credentials.js';
import { parseJson, type RequestContext, type Sandbox } from './arguments.js';
import { credentialHeaders } from './credentials.js';
import { inspect } from './http.js';
import { expectPointer, resolvePointer, type PointerResult } from './json-pointer.js';

/** Where a state claim reads: an inspection endpoint read with a named credential. */
export interface StateSource {
  readonly request: RequestContext;
  readonly sandbox: Sandbox;
  readonly path: string;
  readonly credential: string;
  /** The Sandbox profile's credentials, resolved by the generated file. */
  readonly credentials: SandboxCredentials;
}

/** One read of a state document at a JSON Pointer, as a polling barrier compares it. */
export interface StateProbe {
  readonly status: number;
  readonly at: PointerResult;
}

export const describeSource = (source: StateSource): string =>
  `the state at ${source.path} as "${source.credential}"`;

/** Reads the state document; the inspection must answer 200 with JSON. */
export async function readState(source: StateSource): Promise<unknown> {
  const exchange = await inspect(
    source.request,
    source.sandbox,
    source.path,
    credentialHeaders(source.credential, source.credentials),
  );
  expect(exchange.status, `inspection status of ${describeSource(source)}`).toBe(200);
  return parseJson(exchange.body, describeSource(source));
}

/** What the state document holds at `pointer`. */
export async function readStateAt(source: StateSource, pointer: string): Promise<PointerResult> {
  expectPointer(pointer);
  return resolvePointer(await readState(source), pointer);
}

/**
 * A probe for a polling barrier: one inspection per call. Until the endpoint
 * answers 200 the pointer counts as not found, so the barrier keeps polling;
 * the credential and pointer are checked before the first probe.
 */
export function stateProbe(source: StateSource, pointer: string): () => Promise<StateProbe> {
  expectPointer(pointer);
  const headers = credentialHeaders(source.credential, source.credentials);
  return async () => {
    const exchange = await inspect(source.request, source.sandbox, source.path, headers);
    if (exchange.status !== 200) {
      return { status: exchange.status, at: { found: false } };
    }
    return {
      status: 200,
      at: resolvePointer(parseJson(exchange.body, describeSource(source)), pointer),
    };
  };
}

/** The length of the array at a pointer, or null when nothing or no array is there. */
export function itemCount(result: PointerResult): number | null {
  return result.found && Array.isArray(result.value) ? result.value.length : null;
}
