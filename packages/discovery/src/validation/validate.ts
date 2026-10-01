import { auditSchema, receiptSchema, inspectorSchema } from './bundled-schemas.js';
import type { Audit } from '../model/audit.js';
import type { ReceiptBundle } from '../model/receipts.js';
import { validateShape } from './schema.js';
import { graphChecks, boundaryChecks } from './graph-checks.js';
import { outcomeChecks } from './outcome-checks.js';
import { receiptChecks } from './receipt-checks.js';
import type { Diagnostic, ValidationResult } from './result.js';

/** Shape and record-consistency checks only. Never executes a submitted command or opens a receipt path. */
export function validateAudit(input: unknown, receiptInput: unknown): ValidationResult {
  const shapeErrors = [
    ...validateShape(input, auditSchema),
    ...validateShape(receiptInput, receiptSchema),
  ];
  if (shapeErrors.length > 0) {
    return { kind: 'rejected', diagnostics: shapeErrors };
  }
  // The closed bundled schemas were checked before narrowing the external JSON values.
  const audit = input as Audit;
  const receipts = receiptInput as ReceiptBundle;
  const errors = [
    ...graphChecks(audit),
    ...boundaryChecks(audit),
    ...outcomeChecks(audit),
    ...receiptChecks(audit, receipts),
  ];
  return errors.length > 0
    ? { kind: 'rejected', diagnostics: errors }
    : {
        kind: 'accepted',
        qualification: 'structure-and-receipt-links-only',
        provenance: receipts.provenance.kind,
      };
}

/** Inspector fragments are checked structurally before merging their separately identified evidence. */
export function validateInspectorResult(input: unknown): readonly Diagnostic[] {
  return validateShape(input, inspectorSchema);
}
