import { expect, it } from 'vitest';
import {
  collectorHeaders,
  postJson,
  traceRequest,
  withCollector,
} from '../test-fixtures/collector.js';

function activation(identity: {
  readonly sessionId: string;
  readonly executionId: string;
}): Record<string, unknown> {
  return {
    ...identity,
    schemaVersion: 1,
    kind: 'instrumentation-activation-v1',
    runtime: 'node',
    serviceName: 'orders-api',
  };
}

it('requires the bearer token for activation, ingest, and read endpoints', async () => {
  await withCollector(async ({ collector }) => {
    const readiness = await fetch(collector.endpoint.readinessUrl);
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({ kind: 'collector-ready' });
    const requests = [
      fetch(collector.endpoint.activationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activation(collector)),
      }),
      fetch(collector.endpoint.tracesUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(traceRequest()),
      }),
      fetch(collector.endpoint.readUrl),
    ];
    expect((await Promise.all(requests)).map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    expect(collector.status()).toMatchObject({
      instrumentation: { kind: 'not-activated' },
      telemetry: { status: 'not-received' },
    });
  });
});

it('durably records exact-identity activation and remains idempotent per service', async () => {
  await withCollector(async ({ input, collector }) => {
    const body = activation(input);
    const activate = async (value: unknown): Promise<Response> =>
      await fetch(collector.endpoint.activationUrl, {
        method: 'POST',
        headers: collectorHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(value),
      });

    expect((await activate(body)).status).toBe(200);
    expect((await activate(body)).status).toBe(200);
    expect(collector.status().instrumentation).toMatchObject({
      kind: 'activated',
      activations: [{ runtime: 'node', serviceName: 'orders-api' }],
    });
    expect(
      (await activate({ ...body, executionId: 'different-execution' })).status,
    ).toBe(409);
    expect((await postJson(collector, traceRequest())).status).toBe(200);
  });
});
