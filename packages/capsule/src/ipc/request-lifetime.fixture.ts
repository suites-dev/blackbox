import type { CapsuleManagerRequest, CapsuleManagerResponse } from '../protocol.js';

export interface RequestLifetimeCase {
  readonly name: string;
  readonly request: Exclude<CapsuleManagerRequest, { readonly kind: 'interactive-exec-request' }>;
  readonly response: CapsuleManagerResponse;
}

export const requestLifetimeCases = [
  {
    name: 'captured execution',
    request: {
      kind: 'exec-request',
      requestId: 'exec-1',
      purpose: 'stimulus',
      target: { kind: 'host', argv: ['missing'] },
    },
    response: {
      kind: 'exec-response',
      requestId: 'exec-1',
      activityId: '00000000-0000-4000-8000-000000000042',
      outcome: {
        kind: 'executable-not-found',
        argv: ['missing'],
        location: { kind: 'host' },
        remediation: 'Install missing',
      },
    },
  },
  {
    name: 'Capsule teardown',
    request: { kind: 'stop-request', requestId: 'stop-1', reason: 'completed' },
    response: { kind: 'stop-response', requestId: 'stop-1', cleanup: 'complete' },
  },
] satisfies readonly RequestLifetimeCase[];
