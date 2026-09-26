import { readFileSync } from 'node:fs';

export const driverPrepareRequestSchemaUrl = new URL(
  '../../schema/driver-prepare-request-v1.json',
  import.meta.url,
);
export const driverPrepareResponseSchemaUrl = new URL(
  '../../schema/driver-prepare-response-v1.json',
  import.meta.url,
);
export const driverRuntimeSchemaUrl = new URL(
  '../../schema/driver-runtime-v1.json',
  import.meta.url,
);

export const driverPrepareRequestSchema = JSON.parse(
  readFileSync(driverPrepareRequestSchemaUrl, 'utf8'),
) as object;
export const driverPrepareResponseSchema = JSON.parse(
  readFileSync(driverPrepareResponseSchemaUrl, 'utf8'),
) as object;
export const driverRuntimeSchema = JSON.parse(
  readFileSync(driverRuntimeSchemaUrl, 'utf8'),
) as object;
