import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { discoverySkill } from '../skills.js';
import { validateAudit } from '../validation/validate.js';
import type { Graph } from '../model/graph.js';

/** Deliberately mutable JSON documents: negative tests remove fields and insert invalid variants. */
export type AuditDocument = Record<string, any>;
export interface ReceiptDocument extends Record<string, any> {
  receipts: Record<string, any>[];
}

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

export function graphExample(name = 'http'): Mutable<Graph> {
  return example(name).audit.graph as Mutable<Graph>;
}

export function receipt(bundle: ReceiptDocument, kind: string): Record<string, any> {
  const found = bundle.receipts.find((item) => item.kind === kind);
  assert.ok(found);
  return found;
}

export function example(name = 'http'): { audit: AuditDocument; receipts: ReceiptDocument } {
  const read = (file: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`examples/${name}/${file}.json`, discoverySkill.source), 'utf8'),
    );
  return { audit: read('audit') as AuditDocument, receipts: read('receipts') as ReceiptDocument };
}

export function rejected(audit: unknown, receipts: unknown, code: string): void {
  const result = validateAudit(audit, receipts);
  assert.equal(result.kind, 'rejected');
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    JSON.stringify(result),
  );
}

export function mutate(
  change: (audit: AuditDocument, receipts: ReceiptDocument) => void,
  code: string,
  name = 'http',
): void {
  const { audit, receipts } = example(name);
  change(audit, receipts);
  rejected(audit, receipts, code);
}
