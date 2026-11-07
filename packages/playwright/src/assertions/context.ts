import { AsyncLocalStorage } from 'node:async_hooks';
import type { TestInfo } from '@playwright/test';
import { AssertionScopeError, type AssertionAccounting, type AssertionScopeErrorCode } from './types.js';

export interface Consumption { consumed: boolean; settled: boolean }
export interface AssertionOwner {
  readonly info: TestInfo;
  active: boolean;
  readonly scopes: Set<AssertionScopeState>;
  readonly operations: Set<Consumption>;
  restore: (() => void) | null;
}
export interface AssertionScopeState {
  readonly owner: AssertionOwner;
  readonly parent: AssertionScopeState | null;
  active: boolean;
  readonly records: Set<Invocation>;
  readonly children: Set<AssertionScopeState>;
  readonly issues: { code: AssertionScopeErrorCode; error: unknown }[];
}
export interface Trial { readonly records: Set<Invocation>; readonly issues: unknown[]; thrown: boolean }
export interface Invocation extends Consumption {
  readonly scope: AssertionScopeState;
  readonly parent: Invocation | null;
  readonly name: string;
  readonly poll: boolean;
  status: 'pending' | 'passed' | 'failed';
  stepSeen: boolean;
  completionSeen: boolean;
  readonly failures: unknown[];
  trial: Trial | null;
}
export const scopeContext = new AsyncLocalStorage<AssertionScopeState>();
export const invocationContext = new AsyncLocalStorage<Invocation>();
export const trialContext = new AsyncLocalStorage<Trial>();
export const samplingContext = new AsyncLocalStorage<boolean>();
export const owners = new WeakMap<TestInfo, AssertionOwner>();

export function logicalRecords(input: ReadonlySet<Invocation>): Invocation[] {
  return [...input].filter((record) => {
    for (let parent = record.parent; parent !== null; parent = parent.parent) {
      if (input.has(parent)) { return false; }
    }
    return true;
  });
}

export function accounting(scope: AssertionScopeState): AssertionAccounting {
  const records = logicalRecords(scope.records);
  return Object.freeze({
    total: records.length,
    passed: records.filter((record) => record.status === 'passed').length,
    failed: records.filter((record) => record.status === 'failed').length,
    pending: records.filter((record) => record.status === 'pending').length,
    unconsumed: records.filter((record) => !record.consumed).length,
  });
}

export function scopeError(scope: AssertionScopeState, code: AssertionScopeErrorCode) {
  return new AssertionScopeError(code, accounting(scope), Object.freeze([
    ...scope.issues.map(({ error }) => error),
    ...logicalRecords(scope.records).flatMap(({ failures }) => failures),
  ]));
}

export function assertActive(scope: AssertionScopeState): void {
  if (!scope.active || !scope.owner.active) { throw scopeError(scope, 'ownership'); }
}

export function issue(scope: AssertionScopeState, code: AssertionScopeErrorCode, error: unknown): void {
  for (let current: AssertionScopeState | null = scope; current !== null; current = current.parent) {
    current.issues.push({ code, error });
  }
}
