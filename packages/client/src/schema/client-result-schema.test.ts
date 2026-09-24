import { readFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { clientResultSchema, clientResultSchemaUrl } from './client-result-schema.js';

describe('client result schema', () => {
  const validate = new Ajv2020({ strict: true }).compile(clientResultSchema);

  it.each([
    { kind: 'json', value: { accepted: true } },
    { kind: 'text', value: 'accepted' },
    { kind: 'empty' },
  ])('accepts %j', (result) => {
    expect(validate(result)).toBe(true);
  });

  it.each([
    { kind: 'text' },
    { kind: 'empty', value: null },
    { kind: 'unknown' },
  ])('rejects %j', (result) => {
    expect(validate(result)).toBe(false);
  });

  it('exports the same schema that is shipped as JSON', async () => {
    const file = JSON.parse(await readFile(clientResultSchemaUrl, 'utf8')) as object;
    expect(clientResultSchema).toStrictEqual(file);
  });
});
