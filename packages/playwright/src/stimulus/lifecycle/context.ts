import { test as nativeTest, type APIRequestContext, type TestInfo } from '@playwright/test';
import type { BlackboxStep } from '../../steps/types.js';
import type { StateRegistry } from '../../state/types.js';
import { createExecutionJournal } from './journal.js';

export type LifecycleInput = {
  readonly registry: StateRegistry;
  readonly request: APIRequestContext;
  readonly step: BlackboxStep;
} & Readonly<Partial<{ afterActionCapture: (input: { readonly executionId: string; readonly activityId: string }) => Promise<void> }>>;
export type Pending = { readonly title: string; readonly phase: 'initial' | 'precondition' | 'action' | 'final' | 'effects' } & Readonly<Partial<{ activityId: string }>>;
export interface LifecycleContext {
  readonly input: LifecycleInput;
  readonly owner: TestInfo;
  readonly journal: ReturnType<typeof createExecutionJournal>;
  readonly pending: Map<string, Pending>;
  readonly claims: Map<string, { readonly executionId: string; readonly title: string }>;
  active: boolean;
  running: boolean;
  captureFailed: boolean;
}
export function createContext(input: LifecycleInput): LifecycleContext {
  return { input, owner: nativeTest.info(), journal: createExecutionJournal(), pending: new Map(), claims: new Map(), active: true, running: false, captureFailed: false };
}
export function ensureActive(context: LifecycleContext): void {
  if (!context.active) { throw new Error('Blackbox stimulus fixture is no longer active'); }
  let owner: TestInfo;
  try { owner = nativeTest.info(); } catch { throw new Error('Blackbox stimulus belongs to another test attempt'); }
  if (owner !== context.owner) { throw new Error('Blackbox stimulus belongs to another test attempt'); }
}
export function prefix(title: string, allowed: readonly string[]): void {
  if (!allowed.some((word) => title.startsWith(`${word} `) && title.slice(word.length + 1).trim().length > 0)) {
    throw new Error(`Blackbox title must start with ${allowed.join(' or ')} followed by a description`);
  }
}
export function close(context: LifecycleContext): void {
  context.active = false;
  for (const [executionId, item] of context.pending) {
    if (item.phase === 'initial' || item.phase === 'final' || item.phase === 'effects') {
      context.captureFailed = true;
      context.journal.append({ kind: 'capture-failure', executionId, phase: item.phase, error: new Error(`${item.phase} capture interrupted`) });
      if (item.phase === 'initial') { context.journal.append({ kind: 'action', executionId, status: 'not-executed' }); }
    } else if (item.phase === 'precondition') {
      context.journal.append({ kind: 'precondition', executionId, title: item.title, status: 'interrupted' });
      context.journal.append({ kind: 'action', executionId, status: 'not-executed' });
    } else { context.journal.append({ kind: 'action', executionId, status: 'interrupted', ...(item.activityId === undefined ? {} : { activityId: item.activityId }) }); }
  }
  for (const [claimId, item] of context.claims) { context.journal.append({ kind: 'claim', executionId: item.executionId, claimId, title: item.title, status: 'interrupted' }); }
  context.pending.clear(); context.claims.clear();
  if (context.captureFailed) { throw new Error('Blackbox state capture failed during this attempt'); }
}
