import { readFileSync } from 'node:fs';

function readSchema(url: URL): object {
  return JSON.parse(readFileSync(url, 'utf8')) as object;
}

export const capsuleSessionSchemaUrl = new URL(
  '../../schema/capsule-session-v1.json',
  import.meta.url,
);
export const capsuleActivitiesSchemaUrl = new URL(
  '../../schema/capsule-activities-v1.json',
  import.meta.url,
);
export const capsuleOperationalReportSchemaUrl = new URL(
  '../../schema/capsule-operational-report-v1.json',
  import.meta.url,
);

export const capsuleSessionSchema = readSchema(capsuleSessionSchemaUrl);
export const capsuleActivitiesSchema = readSchema(capsuleActivitiesSchemaUrl);
export const capsuleOperationalReportSchema = readSchema(capsuleOperationalReportSchemaUrl);
