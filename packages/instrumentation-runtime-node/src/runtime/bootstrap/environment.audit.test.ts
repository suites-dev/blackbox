import { expect, test } from 'vitest';

import { createNodeTelemetryEnvironment } from './environment.js';

test.fails('audit H6: node telemetry producer includes export delay', () => {
  const result = createNodeTelemetryEnvironment({
    kind: 'node-telemetry-environment',
    tracesEndpoint: 'http://collector/v1/traces',
    activationEndpoint: 'http://collector/v1/activation',
    authorizationToken: 'token',
    sessionId: 'session',
    executionId: 'execution',
    serviceName: 'service',
  });

  expect(result.variables).toHaveProperty('OTEL_BSP_SCHEDULE_DELAY', '200');
});
