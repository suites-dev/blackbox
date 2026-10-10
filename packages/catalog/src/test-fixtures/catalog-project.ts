import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const validCatalog = `schemaVersion: 1
catalog:
  default: orders
  entries:
    orders:
      kind: system
      acquisition:
        adapter: docker-compose@1
        files: [.blackbox/compose/orders.yml]
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness: { path: /health, timeoutMs: 60000 }
      participants:
        api: { service: api, role: entrypoint, runtime: node, activation: node-runtime }
      drivers:
        http:
          kind: project-driver
          runtime: node
          ref: .blackbox/drivers/http.mjs
          target: { kind: participant, participant: api, protocol: http, containerPort: 3000 }
          execution: { kind: host }
          propagation: { kind: w3c-trace-context-propagation, carrier: http-headers }
      observation:
        policyId: orders-v1
        boundaries:
          - { id: effects.http, kind: http, authoritativeFor: [HTTP effects] }
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 1000
        redaction:
          requestBodies: not-captured
          headers: [authorization]
          dynamicIdentifiers: normalized
activations:
  node-runtime:
    ref: .blackbox/instrumentation/bootstrap.mjs
    adapter: node-preload
    version: 1
`;

export async function makeValidProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-command-'));
  await mkdir(join(directory, '.blackbox/compose'), { recursive: true });
  await mkdir(join(directory, '.blackbox/instrumentation'), { recursive: true });
  await mkdir(join(directory, '.blackbox/drivers'), { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'blackbox.config.yaml'), validCatalog, 'utf8'),
    writeFile(join(directory, '.blackbox/compose/orders.yml'), 'services: {}\n', 'utf8'),
    writeFile(join(directory, '.blackbox/instrumentation/bootstrap.mjs'), 'export {};\n', 'utf8'),
    writeFile(join(directory, '.blackbox/drivers/http.mjs'), 'export {};\n', 'utf8'),
  ]);
  return directory;
}
