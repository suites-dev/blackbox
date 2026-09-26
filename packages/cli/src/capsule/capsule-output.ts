import type {
  CapsuleOperationFailure,
  CapsuleReportResult,
} from '@suites/blackbox-capsule-internal';

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
function exhaustive(value: never): never {
  throw new Error(`Unhandled Capsule result: ${String(value)}`);
}
