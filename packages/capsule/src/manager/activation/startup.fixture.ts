import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import { activationSandbox } from './verification.fixture.js';

export function activationStartupSandbox(base: SandboxHandle): SandboxHandle {
  const observed = activationSandbox();
  return {
    ...base,
    telemetry: observed.telemetry,
    inspectTelemetry: () => observed.inspectTelemetry(),
    endpoints: new Map([
      [
        'entrypoint',
        { name: 'entrypoint', service: 'api', containerPort: 3000, host: '127.0.0.1', port: 1 },
      ],
    ]),
    getContainer: () => ({
      service: 'api',
      testcontainer: {
        id: 'api',
        name: 'api',
        host: '127.0.0.1',
        labels: {},
        environment: {},
        networkNames: [],
        mappedPorts: new Map(),
        getMappedPort: () => 1,
      },
    }),
    inspectResources: () => ({
      kind: 'owned-compose-resources',
      projectName: 'project',
      containers: [],
      networks: [],
      volumes: [],
    }),
  };
}
