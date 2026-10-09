import { disposeWithinBudget } from './client-timeouts.js';
import type {
  ClientDefinition,
  ClientEndpoint,
  ClientRegistry,
  ClientSandbox,
  ClientTarget,
} from './types.js';

interface ClientRunOptions {
  readonly cleanupTimeoutMs: number;
  readonly setupTimeoutMs: number;
}

interface CreateWithinDeadlineInput {
  readonly definition: ClientDefinition;
  readonly endpoint: ClientEndpoint;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly deadline: number;
  readonly cleanupTimeoutMs: number;
}

async function withinDeadline<Value>(
  operation: Promise<Value>,
  deadline: number,
): Promise<
  | { readonly kind: 'resolved'; readonly value: Value }
  | { readonly kind: 'rejected'; readonly error: unknown }
  | { readonly kind: 'timeout' }
> {
  const settlement = operation.then(
    (value) => ({ kind: 'resolved' as const, value }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  );
  if (deadline === Infinity) {return settlement;}
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' });
    }, Math.max(1, deadline - Date.now()));
  });
  try {
    return await Promise.race([settlement, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function setupTimeoutError(): Error {
  return new Error('Blackbox client setup exceeded the Playwright test timeout');
}

async function createWithinDeadline(input: CreateWithinDeadlineInput): Promise<unknown> {
  const creation = Promise.resolve().then(() =>
    input.definition.create(input.endpoint, input.environment),
  );
  const result = await withinDeadline(creation, input.deadline);
  if (result.kind === 'resolved') {return result.value;}
  if (result.kind === 'rejected') {throw result.error;}

  const timeoutError = setupTimeoutError();
  const cleanupDeadline = Date.now() + Math.max(1, input.cleanupTimeoutMs);
  const lateCreation = await withinDeadline(creation, cleanupDeadline);
  if (lateCreation.kind === 'timeout') {
    throw new AggregateError(
      [timeoutError, new Error('Client creation did not settle within the cleanup grace period')],
      'Blackbox client setup timed out and its late client could not be disposed',
    );
  }
  if (lateCreation.kind === 'rejected') {throw timeoutError;}
  try {
    await disposeWithinBudget(
      () => input.definition.dispose(lateCreation.value),
      Math.max(1, cleanupDeadline - Date.now()),
    );
  } catch (cleanupError) {
    throw new AggregateError(
      [timeoutError, cleanupError],
      'Blackbox client setup timed out and late client cleanup failed',
    );
  }
  throw timeoutError;
}

export function defineClient<Sdk, const Keys extends readonly string[], Client>(
  sdk: Sdk,
  definition: {
    readonly target: ClientTarget;
    readonly env: Keys;
    readonly create: (
      sdk: Sdk,
      input: {
        readonly endpoint: ClientEndpoint;
        readonly env: Readonly<Record<Keys[number], string>>;
      },
    ) => Client;
    readonly ready: (client: Awaited<Client>) => unknown;
    readonly dispose: (client: Awaited<Client>) => unknown;
  },
): ClientDefinition<Awaited<Client>> {
  if (
    !definition.target.participant.trim() ||
    !Number.isInteger(definition.target.containerPort) ||
    definition.target.containerPort < 1 ||
    definition.target.containerPort > 65535
  ) {
    throw new Error('Client target requires a participant and a valid container port');
  }
  return Object.freeze({
    target: Object.freeze({ ...definition.target }),
    env: Object.freeze([...definition.env]),
    create: async (
      endpoint: ClientEndpoint,
      environment: Readonly<Record<string, string | undefined>>,
    ): Promise<Awaited<Client>> => {
      const env: Record<string, string> = {};
      for (const key of definition.env) {
        const value = environment[key];
        if (value === undefined) {
          throw new Error(`Client environment is missing required key ${JSON.stringify(key)}`);
        }
        env[key] = value;
      }
      return await definition.create(sdk, {
        endpoint,
        env: Object.freeze(env),
      });
    },
    ready: definition.ready,
    dispose: definition.dispose,
  });
}
export async function runClients(
  definitions: ClientRegistry,
  sandbox: ClientSandbox,
  use: (clients: Readonly<Record<string, unknown>>) => Promise<void>,
  options: ClientRunOptions = {
    cleanupTimeoutMs: 25_000,
    setupTimeoutMs: Number.POSITIVE_INFINITY,
  },
): Promise<void> {
  const { cleanupTimeoutMs, setupTimeoutMs } = options;
  const clients: Record<string, unknown> = {};
  const created: { definition: ClientDefinition; client: unknown }[] = [];
  const errors: unknown[] = [];
  const deadline = Number.isFinite(setupTimeoutMs)
    ? Date.now() + Math.max(1, setupTimeoutMs)
    : Infinity;
  try {
    for (const [name, definition] of Object.entries(definitions)) {
      const service =
        sandbox.clientServices === undefined
          ? definition.target.participant
          : (sandbox.clientServices[definition.target.participant] ??
            definition.target.participant);
      const container = sandbox.containers.get(service);
      const inspection = container === undefined ? undefined : container.testcontainer;
      if (inspection === undefined) {
        throw new Error(`Client ${JSON.stringify(name)} participant is unavailable`);
      }
      const port = inspection.getMappedPort({ containerPort: definition.target.containerPort });
      const endpoint = {
        host: inspection.host,
        port,
        protocol: 'http',
        url: `http://${inspection.host}:${port}`,
      };
      const client = await createWithinDeadline({
        definition,
        endpoint,
        environment: inspection.environment,
        deadline,
        cleanupTimeoutMs,
      });
      created.push({ definition, client });
      clients[name] = client;
      const ready = await withinDeadline(
        Promise.resolve().then(() => definition.ready(client)),
        deadline,
      );
      if (ready.kind === 'timeout') {throw setupTimeoutError();}
      if (ready.kind === 'rejected') {throw ready.error;}
    }
    await use(Object.freeze(clients));
  } catch (error) {
    errors.push(error);
  } finally {
    for (const { definition, client } of created.reverse()) {
      try {
        await disposeWithinBudget(
          () => definition.dispose(client),
          Math.max(1, cleanupTimeoutMs / created.length),
        );
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Blackbox client setup or cleanup failed');
  }
}
