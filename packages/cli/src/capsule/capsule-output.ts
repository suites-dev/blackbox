import type {
  CapsuleOperationFailure,
  CapsuleReportResult,
} from '@suites/blackbox-capsule-internal';

import { PackageFailure } from '../cli/failure.js';

export interface CapsuleFailureOutput {
  readonly result:
    | Exclude<CapsuleReportResult, { readonly kind: 'capsule-report' }>
    | CapsuleOperationFailure;
  readonly json: boolean;
}
export function capsuleFailure(input: CapsuleFailureOutput): string {
  switch (input.result.kind) {
    case 'capsule-not-found':
      return input.json ? JSON.stringify(input.result) : input.result.message;
    case 'capsule-invalid-state':
      return input.json ? JSON.stringify(input.result) : input.result.message;
    case 'capsule-operation-failed':
      return input.json
        ? JSON.stringify(input.result)
        : `${input.result.error.name}: ${input.result.error.message}`;
    case 'capsule-report-artifact-failed':
      return input.json
        ? JSON.stringify(input.result)
        : `${input.result.artifact} artifact: ${input.result.error.name}: ${input.result.error.message}`;
    default:
      return exhaustive(input.result);
  }
}

/**
 * A Capsule package failure about one capsule: the package's own document plus
 * the surface's `capsule` and `next` fields, so failures read like successes.
 */
export function capsulePackageFailure(
  result: CapsuleFailureOutput['result'],
  capsule: string,
  next: readonly string[] = [],
): PackageFailure {
  return new PackageFailure({
    document: { ...result, capsule, next },
    text: capsuleFailure({ result, json: false }),
  });
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled Capsule result: ${String(value)}`);
}
