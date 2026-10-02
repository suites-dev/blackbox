import { expect, it } from 'vitest';

import { reportSandboxProgress } from './sandbox-progress.js';
import { decodeEvent } from './events.js';

it('reports Docker state without confusing it with application readiness or exposing inspection fields', () => {
  const details: string[] = [];
  reportSandboxProgress(
    {
      protect: () => undefined,
      identify: () => undefined,
      emit: (phase, status, detail) => {
        details.push(`${phase}:${status}:${detail}`);
      },
    },
    {
      kind: 'acquisition-observation',
      sandboxId: 'test',
      projectName: 'test',
      at: 'now',
      observation: {
        kind: 'service-state',
        container: {
          service: 'api',
          containerId: 'private-id',
          containerName: 'sensitive-name',
          state: 'exited',
          health: 'unhealthy',
          termination: { kind: 'exited', exitCode: 7 },
        },
      },
    },
  );
  expect(details).toEqual(['container:info:api: exited; Docker health: unhealthy; exit 7']);
});

const wellFormed = {
  schemaVersion: 1,
  sequence: 1,
  elapsedMs: 0,
  phase: 'sandbox',
  status: 'info',
  detail: 'sandbox-1',
  sandboxId: null,
};

it('decodes events before and after their owning sandbox is known', () => {
  expect(decodeEvent(Buffer.from(JSON.stringify(wellFormed)))).toEqual(wellFormed);
  const tagged = { ...wellFormed, sandboxId: 'sandbox-1' };
  expect(decodeEvent(Buffer.from(JSON.stringify(tagged)))).toEqual(tagged);
});

it.each([
  '{}',
  '{broken',
  JSON.stringify({ schemaVersion: 2 }),
  JSON.stringify({ ...wellFormed, sandboxId: 7 }),
  JSON.stringify({ ...wellFormed, sandboxId: undefined }),
  'x'.repeat(20_000),
])('rejects malformed progress without interpreting it as success', (body) => {
  expect(decodeEvent(Buffer.from(body))).toBeNull();
});
