export interface AssertionAccounting {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  readonly unconsumed: number;
}

export interface AssertionScopeResult<Value> {
  readonly value: Value;
  readonly accounting: AssertionAccounting;
}

export type AssertionScopeErrorCode =
  | 'empty' | 'failed' | 'pending' | 'unconsumed' | 'ownership' | 'unsupported';

export class AssertionScopeError extends Error {
  constructor(
    readonly code: AssertionScopeErrorCode,
    readonly accounting: AssertionAccounting,
    readonly failures: readonly unknown[] = [],
  ) {
    super(`Blackbox assertion scope ${code}: ${messages[code]}`);
    this.name = 'AssertionScopeError';
  }
}

const messages = {
  empty: 'requires at least one recognized assertion',
  failed: 'contains failed assertions',
  pending: 'closed with pending assertions or child scopes',
  unconsumed: 'contains unconsumed asynchronous assertions',
  ownership: 'is not active for this test attempt',
  unsupported: 'requires Playwright 1.64.1, supported native hooks and tracked Blackbox expect; raw native expect or a missing native outcome is unsupported',
} satisfies Record<AssertionScopeErrorCode, string>;

/** An instrumented assertion could not establish its required evidence. */
export class InconclusiveAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InconclusiveAssertionError';
  }
}
