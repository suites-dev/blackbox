import { PassThrough } from 'node:stream';

import { INVALID_SPAN_CONTEXT, trace, type Tracer } from '@opentelemetry/api';
import { expect, it, vi } from 'vitest';

import type { ClientExecutionInput } from '../model/client-types.js';
import { executeClient, runNodeClientProcess } from './client-process.js';

const execution = {
  args: ['GET', '/orders'],
  target: {
    kind: 'entrypoint',
    participantId: 'api',
    service: 'api',
    environment: { TOKEN: 'secret' },
    endpoint: { protocol: 'http', host: '127.0.0.1', port: 43123, url: 'http://127.0.0.1:43123' },
  },
  telemetry: {
    kind: 'enabled',
    sessionId: 'session-1',
    executionId: 'execution-1',
    activityId: 'activity-1',
  },
} satisfies ClientExecutionInput;

const utilityExecution = {
  ...execution,
  telemetry: { kind: 'disabled' },
} satisfies ClientExecutionInput;

function readJson(stream: PassThrough): unknown {
  const value = stream.read() as unknown;
  if (!Buffer.isBuffer(value)) {
    throw new Error('Expected buffered JSON output');
  }
  return JSON.parse(value.toString()) as unknown;
}

it('passes an isolated immutable execution DTO to the client', async () => {
  const run = vi.fn((_input: ClientExecutionInput) => ({ kind: 'empty' }) as const);
  await expect(
    executeClient({ definition: { kind: 'entrypoint', name: 'HTTP', run }, execution }),
  ).resolves.toEqual({ kind: 'empty' });

  const call = run.mock.calls.at(0);
  if (call === undefined) {
    throw new Error('Expected the client callback to be called');
  }
  const [received] = call;
  expect(received).toEqual(execution);
  expect(received).not.toBe(execution);
  expect(Object.isFrozen(received)).toBe(true);
  expect(Object.isFrozen(received.target)).toBe(true);
  expect(Object.isFrozen(received.target.environment)).toBe(true);
});

it('writes a discriminated failure for an invalid default export', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.end(JSON.stringify(utilityExecution));
  await runNodeClientProcess({ definition: {}, input: stdin, output: stdout });
  expect(readJson(stdout)).toMatchObject({
    kind: 'failed',
    metadata: { kind: 'unavailable' },
  });
});

it('rejects a non-JSON value returned as a JSON result', async () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.end(JSON.stringify(utilityExecution));
  await runNodeClientProcess({
    definition: {
      kind: 'utility',
      name: 'Invalid result',
      run: () => ({ kind: 'json', value: circular }),
    },
    input: stdin,
    output: stdout,
  });
  expect(stdout.read().toString()).toContain('Client returned an invalid result');
});

it('retains client metadata when an authored callback fails', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.end(JSON.stringify(execution));
  await runNodeClientProcess({
    definition: {
      kind: 'entrypoint',
      name: 'Create order',
      run: () => {
        throw new Error('request failed');
      },
    },
    input: stdin,
    output: stdout,
  });
  expect(readJson(stdout)).toMatchObject({
    kind: 'failed',
    metadata: {
      kind: 'available',
      client: { kind: 'entrypoint', name: 'Create order' },
    },
    error: { name: 'Error', message: 'request failed' },
  });
});

it('activates a span only for an entrypoint client', async () => {
  const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  const startActiveSpan = vi.fn((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') {
      throw new Error('Expected a span callback');
    }
    return callback(span) as unknown;
  }) as Tracer['startActiveSpan'];
  const getTracer = vi.spyOn(trace, 'getTracer').mockReturnValue({
    startActiveSpan,
    startSpan: () => span,
  });
  await executeClient({
    definition: {
      kind: 'entrypoint',
      name: 'HTTP',
      run: () => ({ kind: 'empty' }),
    },
    execution,
  });
  await executeClient({
    definition: {
      kind: 'utility',
      name: 'Database setup',
      run: () => ({ kind: 'empty' }),
    },
    execution: utilityExecution,
  });

  expect(startActiveSpan).toHaveBeenCalledOnce();
  getTracer.mockRestore();
});

it.each([
  { definitionKind: 'entrypoint', execution: utilityExecution },
  { definitionKind: 'utility', execution },
] as const)('rejects mismatched telemetry for $definitionKind', async ({ definitionKind, execution: input }) => {
  await expect(
    executeClient({
      definition: {
        kind: definitionKind,
        name: 'Mismatched',
        run: () => ({ kind: 'empty' }),
      },
      execution: input,
    }),
  ).rejects.toThrow(/telemetry/u);
});

it('retains client metadata with a completed result', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.end(JSON.stringify(utilityExecution));
  await runNodeClientProcess({
    definition: {
      kind: 'utility',
      name: 'Inspect database',
      run: () => ({ kind: 'empty' }),
    },
    input: stdin,
    output: stdout,
  });
  expect(readJson(stdout)).toMatchObject({
    kind: 'completed',
    metadata: {
      kind: 'available',
      client: { kind: 'utility', name: 'Inspect database' },
    },
    result: { kind: 'empty' },
  });
});
