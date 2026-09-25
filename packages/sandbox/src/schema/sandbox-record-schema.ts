import { readFileSync } from 'node:fs';

export const sandboxRecordSchemaUrl = new URL(
  '../../schema/sandbox-record-v1.json',
  import.meta.url,
);

export const sandboxRecordSchema = JSON.parse(
  readFileSync(sandboxRecordSchemaUrl, 'utf8'),
) as object;
