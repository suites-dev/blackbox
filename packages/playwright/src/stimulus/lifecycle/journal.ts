import type { StateCapture, StateSelection } from '../../state/types.js';

export type LifecycleStatus = 'passed' | 'failed' | 'inconclusive' | 'interrupted';
export type ExecutionEvent =
  | { readonly kind: 'begin'; readonly executionId: string; readonly title: string; readonly selection: StateSelection; readonly initial: StateCapture }
  | { readonly kind: 'precondition'; readonly executionId: string; readonly title: string; readonly status: LifecycleStatus } & Readonly<Partial<{ error: unknown }>>
  | { readonly kind: 'action'; readonly executionId: string; readonly status: 'not-executed' | 'completed' | 'failed' | 'interrupted' } & Readonly<Partial<{ activityId: string; output: unknown; error: unknown }>>
  | { readonly kind: 'capture-failure'; readonly executionId: string; readonly phase: 'initial' | 'final' | 'effects'; readonly error: unknown }
  | { readonly kind: 'final'; readonly executionId: string; readonly final: StateCapture }
  | { readonly kind: 'claim'; readonly executionId: string; readonly claimId: string; readonly title: string; readonly status: LifecycleStatus } & Readonly<Partial<{ error: unknown; snapshots: readonly { readonly matcher: string; readonly status: 'passed' | 'failed' | 'unknown' }[] }>>;

/** In-memory facts only. Consumers must redact and adapt values before persistence. */
export interface ExecutionJournal {
  append(event: ExecutionEvent): void;
  events(): readonly ExecutionEvent[];
  subscribe(listener: (event: ExecutionEvent) => void): () => void;
}

export function createExecutionJournal(): ExecutionJournal {
  const events: ExecutionEvent[] = [];
  const listeners = new Set<(event: ExecutionEvent) => void>();
  return {
    append(event) {
      const fact = Object.freeze(event);
      events.push(fact);
      for (const listener of listeners) { listener(fact); }
    },
    events: () => Object.freeze([...events]),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
