import { readFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { clientInspectionSchema, clientInspectionSchemaUrl } from './client-inspection-schema.js';

describe('client inspection schema', () => {
  const validate = new Ajv2020({ strict: true }).compile(clientInspectionSchema);

  it.each([
    { kind: 'available', client: { kind: 'entrypoint', name: 'Create order' } },
    { kind: 'available', client: { kind: 'utility', name: 'Inspect database' } },
    {
      kind: 'unavailable',
      error: { name: 'InvalidClientDefinitionError', message: 'Invalid definition' },
    },
  ])('accepts %j', (result) => {
    expect(validate(result)).toBe(true);
  });

  it.each([
    { kind: 'available', client: { kind: 'utility', name: '   ' } },
    { kind: 'available', client: { kind: 'unknown', name: 'Unknown' } },
    { kind: 'unavailable' },
  ])('rejects %j', (result) => {
    expect(validate(result)).toBe(false);
  });

  it('exports the schema shipped as JSON', async () => {
    const file = JSON.parse(await readFile(clientInspectionSchemaUrl, 'utf8')) as object;
    expect(clientInspectionSchema).toStrictEqual(file);
  });
});
