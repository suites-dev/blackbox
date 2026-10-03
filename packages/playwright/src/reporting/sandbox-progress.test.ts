import { expect, it } from 'vitest';

import { reportSandboxProgress } from './sandbox-progress.js';
import { decodeEvent } from './events.js';

it('reports Docker state without confusing it with application readiness or exposing inspection fields', () => {
  const details: string[] = [];
  reportSandboxProgress(
    {
      protect: () => undefined,
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

it.each(['{}', '{broken', JSON.stringify({ schemaVersion: 2 }), 'x'.repeat(20_000)])(
  'rejects malformed progress without interpreting it as success',
  (body) => {
    expect(decodeEvent(Buffer.from(body))).toBeNull();
  },
);
