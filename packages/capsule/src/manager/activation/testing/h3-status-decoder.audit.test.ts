import { expect, test } from 'vitest';

import { readCollectorActivationStatus } from '../status.js';
import { collectorStatusServer } from './http-status.fixture.js';

const statusWithEmptyServiceName = {
  kind: 'collector-status',
  sessionId: 'quiet-river-ada',
  executionId: 'execution-1',
  instrumentation: {
    kind: 'activated',
    activations: [
      {
        kind: 'instrumentation-activation',
        runtime: 'node',
        serviceName: '',
      },
    ],
  },
};

test('audit H3: capsule rejects empty collector service names', async () => {
  const receiver = await collectorStatusServer({
    body: JSON.stringify(statusWithEmptyServiceName),
    status: 200,
  });
  try {
    await expect(
      readCollectorActivationStatus({
        kind: 'read-collector-activation-status',
        sessionId: 'quiet-river-ada',
        executionId: 'execution-1',
        token: 'token',
        url: receiver.telemetry.endpoints.readUrl,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('Collector status activation service name is invalid');
  } finally {
    await receiver.close();
  }
});
