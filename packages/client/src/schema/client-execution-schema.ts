import { readFileSync } from 'node:fs';

export const clientExecutionSchemaUrl = new URL(
  '../../schema/client-execution-v1.json',
  import.meta.url,
);

export const clientExecutionSchema = JSON.parse(
  readFileSync(clientExecutionSchemaUrl, 'utf8'),
) as object;
