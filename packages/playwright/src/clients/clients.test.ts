import { expect, expectTypeOf, it, vi } from 'vitest';
import { defineClient, runClients } from './clients.js';
import type { BlackboxSandbox } from '../types.js';

const sandbox = {
  sandboxId: 'sandbox',
  executionId: 'attempt',
  catalogEntry: { kind: 'system', id: 'app' },
  projectName: 'project',
  artifactDirectory: '/tmp',
  entrypoint: { host: '127.0.0.1', port: 1234, protocol: 'http', url: 'http://127.0.0.1:1234' },
  clientServices: { api: 'service' },
  containers: new Map([
    [
      'service',
      {
        service: 'service',
        testcontainer: {
          id: 'container',
          name: 'container',
          host: '127.0.0.1',
          labels: {},
          networkNames: [],
          environment: { TOKEN: 'secret', OTHER: 'excluded' },
          mappedPorts: new Map([[3000, 1234]]),
          getMappedPort: () => 1234,
        },
      },
    ],
  ]),
} satisfies BlackboxSandbox;

it('preserves SDK/client types and selects only declared effective environment', async () => {
  const create = vi.fn(
    (_sdk: { value: number }, input: { endpoint: { port: number }; env: { TOKEN: string } }) =>
      Promise.resolve({ value: input.endpoint.port }),
  );
  const definition = defineClient(
    { value: 1 },
    {
      target: { participant: 'api', containerPort: 3000 },
      env: ['TOKEN'] as const,
      create,
      ready: () => undefined,
      dispose: () => undefined,
    },
  );
  expectTypeOf(await definition.create(sandbox.entrypoint, { TOKEN: 'value' })).toEqualTypeOf<{
    value: number;
  }>();
  create.mockClear();
  await runClients({ api: definition }, sandbox, (clients) => {
    expect(clients.api).toEqual({ value: 1234 });
    return Promise.resolve();
  });
  expect(create).toHaveBeenCalledWith(
    { value: 1 },
    { endpoint: sandbox.entrypoint, env: { TOKEN: 'secret' } },
  );
});

it('rejects missing environment before creation without exposing values', async () => {
  const create = vi.fn(() => ({}));
  const definition = defineClient(
    {},
    {
      target: { participant: 'api', containerPort: 3000 },
      env: ['MISSING'] as const,
      create,
      ready: () => undefined,
      dispose: () => undefined,
    },
  );
  await expect(runClients({ api: definition }, sandbox, () => Promise.resolve())).rejects.toThrow(
    'missing required key "MISSING"',
  );
  expect(create).not.toHaveBeenCalled();
});

it('readiness failure prevents use and disposes every created client despite disposal failures', async () => {
  const events: string[] = [];
  const definition = (name: string, fail: boolean) =>
    defineClient(
      {},
      {
        target: { participant: 'api', containerPort: 3000 },
        env: [] as const,
        create: () => {
          events.push(`create ${name}`);
          return { name };
        },
        ready: () => {
          events.push(`ready ${name}`);
          if (fail) {
            throw new Error('not ready');
          }
        },
        dispose: () => {
          events.push(`dispose ${name}`);
          if (fail) {
            throw new Error('dispose failed');
          }
        },
      },
    );
  const use = vi.fn(() => Promise.resolve());
  await expect(
    runClients(
      { first: definition('first', false), second: definition('second', true) },
      sandbox,
      use,
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(use).not.toHaveBeenCalled();
  expect(events).toEqual([
    'create first',
    'ready first',
    'create second',
    'ready second',
    'dispose second',
    'dispose first',
  ]);
});

it('owns fresh clients per invocation and disposes after a failing body', async () => {
  const created: object[] = [];
  const disposed: object[] = [];
  const definition = defineClient(
    {},
    {
      target: { participant: 'api', containerPort: 3000 },
      env: [] as const,
      create: () => {
        const client = {};
        created.push(client);
        return client;
      },
      ready: () => undefined,
      dispose: (client) => {
        disposed.push(client);
      },
    },
  );
  await runClients({ api: definition }, sandbox, () => Promise.resolve());
  await expect(
    runClients({ api: definition }, sandbox, () => Promise.reject(new Error('body'))),
  ).rejects.toThrow('body');
  expect(created).toHaveLength(2);
  expect(created[0]).not.toBe(created[1]);
  expect(disposed).toEqual(created);
});

it('continues disposal after a client exceeds its cleanup budget', async () => {
  const disposed: string[] = [];
  const definition = (name: string, hang: boolean) =>
    defineClient(
      {},
      {
        target: { participant: 'api', containerPort: 3000 },
        env: [] as const,
        create: () => ({ name }),
        ready: () => undefined,
        dispose: () => {
          disposed.push(name);
          return hang ? new Promise<void>(() => undefined) : Promise.resolve();
        },
      },
    );
  await expect(
    runClients(
      { first: definition('first', false), second: definition('second', true) },
      sandbox,
      () => Promise.resolve(),
      20,
    ),
  ).rejects.toThrow('client disposal exceeded');
  expect(disposed).toEqual(['second', 'first']);
});
