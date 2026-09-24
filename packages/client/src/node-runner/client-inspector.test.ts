import { PassThrough } from 'node:stream';

import { expect, it } from 'vitest';

import { inspectNodeClientDefinition } from './client-inspector.js';

function readJson(stream: PassThrough): unknown {
  const value = stream.read() as unknown;
  if (!Buffer.isBuffer(value)) {
    throw new Error('Expected buffered JSON output');
  }
  return JSON.parse(value.toString()) as unknown;
}

it.each(['entrypoint', 'utility'] as const)('reports valid %s metadata', (kind) => {
  const output = new PassThrough();
  const result = inspectNodeClientDefinition({
    definition: { kind, name: 'Orders client', run: () => ({ kind: 'empty' }) },
    output,
  });

  const expected = {
    kind: 'available',
    client: { kind, name: 'Orders client' },
  };
  expect(result).toStrictEqual(expected);
  expect(readJson(output)).toStrictEqual(expected);
});

it.each([
  null,
  {},
  { kind: 'entrypoint', name: '', run: () => ({ kind: 'empty' }) },
  { kind: 'utility', name: 'Missing callback' },
])('reports unavailable for invalid definition %#', (definition) => {
  const output = new PassThrough();
  const result = inspectNodeClientDefinition({ definition, output });

  expect(result).toStrictEqual({
    kind: 'unavailable',
    error: {
      name: 'InvalidClientDefinitionError',
      message: 'Client module default export is not a valid client definition',
    },
  });
  expect(readJson(output)).toStrictEqual(result);
});
