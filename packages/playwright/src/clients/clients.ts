import { disposeWithinBudget } from './client-timeouts.js';
import type {
  ClientDefinition,
  ClientEndpoint,
  ClientRegistry,
  ClientSandbox,
  ClientTarget,
} from './types.js';

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
  cleanupTimeoutMs = 25_000,
): Promise<void> {
  const clients: Record<string, unknown> = {};
  const created: { definition: ClientDefinition; client: unknown }[] = [];
  const errors: unknown[] = [];
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
      const client = await definition.create(endpoint, inspection.environment);
      created.push({ definition, client });
      clients[name] = client;
      await definition.ready(client);
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
