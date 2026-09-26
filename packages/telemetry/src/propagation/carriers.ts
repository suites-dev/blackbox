import type { W3CTraceContext } from '../context/model.js';

export interface InjectTextMapInput {
  readonly context: W3CTraceContext;
  readonly carrier: Readonly<Record<string, string>>;
}

export interface InjectedTextMapCarrier {
  readonly kind: 'w3c-text-map-carrier';
  readonly values: Readonly<Record<string, string>>;
}

export interface InjectedProcessEnvironment {
  readonly kind: 'w3c-process-environment-carrier';
  readonly variables: Readonly<Record<string, string>>;
}

function requireContext(context: W3CTraceContext): void {
  const traceparent =
    `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
  if (context.traceparent !== traceparent) {
    throw new Error('W3C trace context fields do not match traceparent.');
  }
  if (
    context.traceState.kind === 'trace-state-present' &&
    context.traceState.value.trim() === ''
  ) {
    throw new Error('W3C tracestate must be non-empty when present.');
  }
}

function traceStateValue(context: W3CTraceContext): Readonly<Record<string, string>> {
  return context.traceState.kind === 'trace-state-present'
    ? { tracestate: context.traceState.value }
    : {};
}

function withoutTraceContext(
  carrier: Readonly<Record<string, string>>,
): Record<string, string> {
  const retained: Record<string, string> = {};
  for (const [name, value] of Object.entries(carrier)) {
    const normalized = name.toLowerCase();
    if (normalized !== 'traceparent' && normalized !== 'tracestate') {
      retained[name] = value;
    }
  }
  return retained;
}

function requireCanonicalEnvironment(
  context: W3CTraceContext,
  carrier: Readonly<Record<string, string>>,
): void {
  const expected = new Map([['TRACEPARENT', context.traceparent]]);
  if (context.traceState.kind === 'trace-state-present') {
    expected.set('TRACESTATE', context.traceState.value);
  }
  for (const [name, value] of Object.entries(carrier)) {
    const canonical = name.toUpperCase();
    if (canonical !== 'TRACEPARENT' && canonical !== 'TRACESTATE') {
      continue;
    }
    if (name !== canonical || expected.get(canonical) !== value) {
      throw new Error(`Process environment contradicts canonical ${canonical}.`);
    }
  }
}

export function injectW3CTextMap(
  input: InjectTextMapInput,
): InjectedTextMapCarrier {
  requireContext(input.context);
  return {
    kind: 'w3c-text-map-carrier',
    values: {
      ...withoutTraceContext(input.carrier),
      traceparent: input.context.traceparent,
      ...traceStateValue(input.context),
    },
  };
}

export function injectW3CProcessEnvironment(
  input: InjectTextMapInput,
): InjectedProcessEnvironment {
  requireContext(input.context);
  requireCanonicalEnvironment(input.context, input.carrier);
  const variables = withoutTraceContext(input.carrier);
  variables.TRACEPARENT = input.context.traceparent;
  if (input.context.traceState.kind === 'trace-state-present') {
    variables.TRACESTATE = input.context.traceState.value;
  }
  return { kind: 'w3c-process-environment-carrier', variables };
}
