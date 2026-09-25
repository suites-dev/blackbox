export const validActivation = {
  kind: 'instrumentation-activation', runtime: 'node', serviceName: 'api',
  activatedAt: '2026-09-25T10:00:00.000Z',
} as const;

export function validCollectorStatus(input: {
  readonly sessionId: string;
  readonly executionId: string;
}) {
  return { kind: 'collector-status', sessionId: input.sessionId, executionId: input.executionId,
    instanceId: 'collector-instance',
    receiver: 'ready', shutdown: 'not-started', failure: null,
    telemetry: { status: 'not-received', acceptedRequests: 0, acceptedSpans: 0, lastReceivedAt: null },
    instrumentation: { kind: 'activated', activations: [validActivation] },
  } as const;
}

const status = validCollectorStatus({ sessionId: 'quiet-river-ada', executionId: 'execution-1' });

function instrumentation(value: unknown): object {
  return { ...status, instrumentation: value };
}

function activation(value: unknown): object {
  return instrumentation({ kind: 'activated', activations: [validActivation, value] });
}

export const malformedCollectorStatuses = [
  { name: 'null document', value: null, error: 'Collector status response is invalid' },
  { name: 'array document', value: [], error: 'Collector status response is invalid' },
  { name: 'wrong document kind', value: { ...status, kind: 'other' }, error: 'Collector status response is invalid' },
  { name: 'foreign session', value: { ...status, sessionId: 'another' }, error: 'identity does not match' },
  { name: 'foreign execution', value: { ...status, executionId: 'another' }, error: 'identity does not match' },
  { name: 'null instrumentation', value: instrumentation(null), error: 'instrumentation status is invalid' },
  { name: 'array instrumentation', value: instrumentation([]), error: 'instrumentation status is invalid' },
  { name: 'unknown instrumentation kind', value: instrumentation({ kind: 'other' }), error: 'instrumentation status is invalid' },
  { name: 'missing activation list', value: instrumentation({ kind: 'activated' }), error: 'instrumentation status is invalid' },
  { name: 'null activation list', value: instrumentation({ kind: 'activated', activations: null }), error: 'instrumentation status is invalid' },
  { name: 'object activation list', value: instrumentation({ kind: 'activated', activations: {} }), error: 'instrumentation status is invalid' },
  { name: 'null activation after valid evidence', value: activation(null), error: 'invalid instrumentation activation' },
  { name: 'wrong activation kind after valid evidence', value: activation({ ...validActivation, kind: 'other' }), error: 'invalid instrumentation activation' },
  { name: 'missing runtime after valid evidence', value: activation({ kind: 'instrumentation-activation', serviceName: 'api' }), error: 'activation runtime is invalid' },
  { name: 'numeric runtime after valid evidence', value: activation({ ...validActivation, runtime: 1 }), error: 'activation runtime is invalid' },
  { name: 'empty runtime after valid evidence', value: activation({ ...validActivation, runtime: '' }), error: 'activation runtime is invalid' },
  { name: 'blank runtime after valid evidence', value: activation({ ...validActivation, runtime: ' \t\n' }), error: 'activation runtime is invalid' },
  { name: 'missing service after valid evidence', value: activation({ kind: 'instrumentation-activation', runtime: 'node' }), error: 'activation service name is invalid' },
  { name: 'numeric service after valid evidence', value: activation({ ...validActivation, serviceName: 1 }), error: 'activation service name is invalid' },
  { name: 'empty service after valid evidence', value: activation({ ...validActivation, serviceName: '' }), error: 'activation service name is invalid' },
  { name: 'blank service after valid evidence', value: activation({ ...validActivation, serviceName: ' \t\n' }), error: 'activation service name is invalid' },
] as const;
