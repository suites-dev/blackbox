import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SandboxEndpointRequest } from '../types.js';

export async function writeEndpointComposeOverride(input: {
  readonly endpoints: readonly SandboxEndpointRequest[];
  readonly directory: string;
}): Promise<string> {
  await mkdir(input.directory, { recursive: true });
  const ports = new Map<string, Set<number>>();
  for (const endpoint of input.endpoints) {
    const existing = ports.get(endpoint.service);
    if (existing === undefined) {
      ports.set(endpoint.service, new Set([endpoint.containerPort]));
    } else {
      existing.add(endpoint.containerPort);
    }
  }
  const services: Record<string, object> = {};
  for (const [service, containerPorts] of ports) {
    services[service] = {
      ports: [...containerPorts]
        .sort((left, right) => left - right)
        .map((port) => `127.0.0.1::${port}`),
    };
  }
  const path = join(input.directory, 'endpoints.compose.json');
  await writeFile(path, `${JSON.stringify({ services }, null, 2)}\n`, 'utf8');
  return path;
}
