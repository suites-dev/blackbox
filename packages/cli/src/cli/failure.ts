import { EXIT_CODES, type UsageExit } from './exit-codes.js';

/** Codes of failures raised by the CLI layer itself (the `cli-error` document). */
export type CliErrorCode =
  | 'usage'
  | 'capsule-unresolved'
  | 'capsule-not-running'
  | 'id-unknown'
  | 'id-ambiguous'
  | 'id-capsule-mismatch'
  | 'down-requires-capsule'
  | 'system-required'
  | 'conflicting-output'
  | 'current-capsule-write-failed'
  /** Any other Blackbox failure raised in the CLI layer (for example an occupied viewer port). */
  | 'operation-failed';

export interface CliCandidate {
  readonly id: string;
  readonly type: 'activity' | 'trace' | 'capsule';
  readonly capsule: string;
  readonly name: string | null;
}

export interface CliErrorDetail {
  readonly code: CliErrorCode;
  /** First line of the human message; also the JSON `message`. */
  readonly message: string;
  /** Extra human lines printed under the message (indented). */
  readonly details: readonly string[];
  readonly candidates: readonly CliCandidate[];
  readonly next: readonly string[];
}

interface CliErrorDocumentBase {
  readonly kind: 'cli-error';
  readonly code: CliErrorCode;
  readonly message: string;
  readonly next: readonly string[];
}

/** `candidates` is present only for id-ambiguous and a known id-capsule-mismatch owner. */
export type CliErrorDocument =
  CliErrorDocumentBase | (CliErrorDocumentBase & { readonly candidates: readonly CliCandidate[] });

/** A CLI-layer failure. Commands throw it; the base command renders it once. */
export class CliFailure extends Error {
  readonly detail: CliErrorDetail;

  constructor(detail: CliErrorDetail) {
    super(detail.message);
    this.name = 'CliFailure';
    this.detail = detail;
  }
}

const BLACKBOX_FAILURE_CODES = new Set<CliErrorCode>([
  'capsule-not-running',
  'current-capsule-write-failed',
  'operation-failed',
]);

export function cliFailureExit(code: CliErrorCode, usageExit: UsageExit): number {
  return BLACKBOX_FAILURE_CODES.has(code) ? EXIT_CODES.blackboxFailure : usageExit;
}

export function cliErrorDocument(detail: CliErrorDetail): CliErrorDocument {
  const withCandidates =
    detail.code === 'id-ambiguous' ||
    (detail.code === 'id-capsule-mismatch' && detail.candidates.length > 0);
  const base = { kind: 'cli-error', code: detail.code, message: detail.message } as const;
  return withCandidates
    ? { ...base, candidates: detail.candidates, next: detail.next }
    : { ...base, next: detail.next };
}

export function cliErrorLines(detail: CliErrorDetail): readonly string[] {
  return [
    `blackbox: ${detail.message}`,
    ...detail.details.map((line) => `  ${line}`),
    ...detail.next.map((next) => `→ ${next}`),
  ];
}

/**
 * A failure returned by the Capsule or catalog package. It keeps that package's
 * existing document (optionally extended by the command) and today's text.
 */
export class PackageFailure extends Error {
  readonly document: unknown;
  readonly text: string;

  constructor(input: { readonly document: unknown; readonly text: string }) {
    super(input.text);
    this.name = 'PackageFailure';
    this.document = input.document;
    this.text = input.text;
  }
}

export function cliFailure(
  code: CliErrorCode,
  message: string,
  next: readonly string[] = [],
): CliFailure {
  return new CliFailure({ code, message, details: [], candidates: [], next });
}
