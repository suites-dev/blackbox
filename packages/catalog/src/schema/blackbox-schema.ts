import { readFileSync } from 'node:fs';

export const catalogSchemaUrl = new URL('../../schema/blackbox-config-v1.json', import.meta.url);

export const catalogSchema = JSON.parse(readFileSync(catalogSchemaUrl, 'utf8')) as object;
