import { readFileSync } from 'node:fs';

export const clientInspectionSchemaUrl = new URL(
  '../../schema/client-inspection-v1.json',
  import.meta.url,
);

export const clientInspectionSchema = JSON.parse(
  readFileSync(clientInspectionSchemaUrl, 'utf8'),
) as object;
