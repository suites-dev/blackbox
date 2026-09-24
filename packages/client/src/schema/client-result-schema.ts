import { readFileSync } from 'node:fs';

export const clientResultSchemaUrl = new URL(
  '../../schema/client-result-v1.json',
  import.meta.url,
);

export const clientResultSchema = JSON.parse(
  readFileSync(clientResultSchemaUrl, 'utf8'),
) as object;
