import { startReportServer } from '../http/server.js';
import { selectionQuery } from '../ui/registry-page.js';
import type {
  EnsureReportServerInput,
  EnsureReportServerResult,
  ReportServerIdentity,
} from '../model/identity.js';

function matchesIdentity(input: { actual: unknown; expected: ReportServerIdentity }): boolean {
  const actual = input.actual;
  if (typeof actual !== 'object' || actual === null) {
    return false;
  }
  if (
    !('kind' in actual) ||
    actual.kind !== input.expected.kind ||
    !('schemaVersion' in actual) ||
    actual.schemaVersion !== 1
  ) {
    return false;
  }
  if (!('scopeId' in actual) || actual.scopeId !== input.expected.scopeId) {
    return false;
  }
  if (!('providerTypes' in actual) || !Array.isArray(actual.providerTypes)) {
    return false;
  }
  const types = actual.providerTypes;
  return (
    types.length === input.expected.providerTypes.length &&
    input.expected.providerTypes.every((type, index) => types[index] === type)
  );
}

async function identifiesViewer(input: {
  port: number;
  identity: ReportServerIdentity;
}): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${input.port}/api/server`, {
      signal: AbortSignal.timeout(1500),
      redirect: 'error',
    });
    if (!response.ok) {
      return false;
    }
    return matchesIdentity({ actual: await response.json(), expected: input.identity });
  } catch {
    return false;
  }
}

/** Binding is the ownership lock: reused callers receive no close capability. */
export async function ensureReportServer(
  input: EnsureReportServerInput,
): Promise<EnsureReportServerResult> {
  if (!/^[a-zA-Z0-9._-]{1,200}$/u.test(input.scopeId)) {
    throw new Error('Report scope must be a nonempty opaque identifier.');
  }
  const identity = {
    kind: 'report-server-identity',
    schemaVersion: 1,
    scopeId: input.scopeId,
    providerTypes: input.providers.map((provider) => provider.type).sort(),
  } satisfies ReportServerIdentity;
  try {
    const server = await startReportServer({
      kind: 'start-scoped-report-server',
      identity,
      providers: input.providers,
      port: input.port,
      selection: input.selection,
    });
    return { kind: 'report-server-started', server };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
      throw error;
    }
    if (!(await identifiesViewer({ port: input.port, identity }))) {
      throw new Error(
        `Report port ${input.port} is occupied by an incompatible viewer or another application. No new port was opened.`,
        { cause: error },
      );
    }
    return {
      kind: 'report-server-reused',
      hostname: '127.0.0.1',
      port: input.port,
      url: `http://127.0.0.1:${input.port}/${selectionQuery(input)}`,
    };
  }
}
