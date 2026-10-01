import { readFileSync } from 'node:fs';
import { discoverySkill } from '../skills.js';

function schema(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`schemas/${name}.json`, discoverySkill.source), 'utf8'),
  ) as unknown;
}

export const auditSchema = schema('discovery-audit.v1');
export const receiptSchema = schema('receipt-bundle.v1');
export const inspectorSchema = schema('inspector-result.v1');
