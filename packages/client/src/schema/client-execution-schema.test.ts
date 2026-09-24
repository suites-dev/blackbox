import { readFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { clientExecutionSchema, clientExecutionSchemaUrl } from './client-execution-schema.js';

const target = {
  kind: 'entrypoint',
  participantId: 'api',
  service: 'api',
  environment: { API_TOKEN: 'secret' },
  endpoint: {
    protocol: 'http',
    host: '127.0.0.1',
    port: 31_234,
    url: 'http://127.0.0.1:31234',
  },
};

describe('client execution schema', () => {
  const validate = new Ajv2020({ strict: true }).compile(clientExecutionSchema);

  it.each([
    {
      args: ['GET', '/orders'],
      target,
      telemetry: {
        kind: 'enabled',
        sessionId: 'session-1',
        executionId: 'execution-1',
        activityId: 'activity-1',
      },
    },
    { args: [], target: { ...target, kind: 'participant' }, telemetry: { kind: 'disabled' } },
  ])('accepts a complete discriminated execution %#', (execution) => {
    expect(validate(execution)).toBe(true);
  });

  it.each([
    { args: [], target, telemetry: { kind: 'enabled' } },
    { args: [], target, telemetry: { kind: 'disabled', activityId: 'unexpected' } },
    { args: [], target: { ...target, kind: 'unknown' }, telemetry: { kind: 'disabled' } },
  ])('rejects an invalid execution %#', (execution) => {
    expect(validate(execution)).toBe(false);
  });

  it('exports the schema shipped as JSON', async () => {
    const file = JSON.parse(await readFile(clientExecutionSchemaUrl, 'utf8')) as object;
    expect(clientExecutionSchema).toStrictEqual(file);
  });
});
