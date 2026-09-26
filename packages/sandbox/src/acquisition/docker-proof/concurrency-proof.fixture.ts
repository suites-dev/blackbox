import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { composeProjectName } from '../../lifecycle/helpers.js';
import { startSandbox } from '../../sandbox.js';
import type { SandboxEndpoint, SandboxHandle } from '../../types.js';
import type { SandboxProgressEvent } from '../progress.js';
import {
  inspectContainers,
  inspectedHostPort,
  inspectNamedResources,
  resourcesForProjects,
  type ContainerInspection,
} from './docker-inspection.fixture.js';
import { logProof } from './concurrency-proof-report.fixture.js';
import { verifyResourceReports } from './resource-proof.fixture.js';
import { verifyExecutionOutcomes } from './execution-proof.fixture.js';

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
);

export interface ProofContext {
  readonly proofToken: string;
  readonly sandboxIds: readonly string[];
  readonly projectNames: readonly string[];
  readonly recordRoot: string;
  readonly handles: SandboxHandle[];
  readonly events: SandboxProgressEvent[];
}

export async function createProofContext(): Promise<ProofContext> {
  const proofToken = `${process.pid}-${Date.now().toString(36)}`;
  const sandboxIds = Array.from({ length: 5 }, (_, index) => `bb-proof-${proofToken}-${index + 1}`);
  return {
    proofToken,
    sandboxIds,
    projectNames: sandboxIds.map((sandboxId) => composeProjectName({ sandboxId })),
    recordRoot: await mkdtemp(join(tmpdir(), `blackbox-sandbox-proof-${proofToken}-`)),
    handles: [],
    events: [],
  };
}

export async function runProof(context: ProofContext): Promise<void> {
  const baseline = await resourcesForProjects({ projectNames: context.projectNames });
  assert.deepEqual(baseline, { containers: [], networks: [], volumes: [] });
  await startProofSandboxes(context);
  const endpoints = requestedEndpoints(context.handles);
  const ports = endpoints.map((endpoint) => endpoint.port);
  assert.equal(new Set(ports).size, 5);
  const identities = await verifyIndependentResponses({ context, endpoints });
  await verifyContainerExecution(context);
  await verifyExecutionOutcomes(context.handles);
  const containers = await verifyDockerResources({ context, ports });
  await verifyResourceReports({
    handles: context.handles,
    projectNames: context.projectNames,
    events: context.events,
  });
  logProof({ context, containers, ports, identities });
}

async function startProofSandboxes(context: ProofContext): Promise<void> {
  const starts = await Promise.allSettled(
    context.sandboxIds.map((sandboxId, index) =>
      startSandbox({
        sandbox: {
          sandboxId,
          projectDirectory: fixtureDirectory,
          composeFiles: ['concurrency.compose.yaml'],
          recordDirectory: join(context.recordRoot, sandboxId),
          environment: { SANDBOX_ID: sandboxId },
          serviceSelection:
            index === 0
              ? { kind: 'all', declaredServices: ['echo'] }
              : { kind: 'selected', services: ['echo'] },
          endpoints: [{ name: 'http', service: 'echo', containerPort: 80 }],
          startupTimeoutMs: 60_000,
          stopTimeoutMs: 20_000,
          telemetry: { kind: 'disabled' },
        },
        progress: {
          kind: 'events',
          sink: { emit: (event) => context.events.push(event) },
        },
      }),
    ),
  );
  const failures: unknown[] = [];
  for (const result of starts) {
    if (result.status === 'fulfilled') {
      context.handles.push(result.value);
    } else {
      failures.push(result.reason);
    }
  }
  if (failures.length > 0 || context.handles.length !== 5) {
    throw new AggregateError(failures, `Only ${context.handles.length}/5 sandboxes started`);
  }
}

function requestedEndpoints(handles: readonly SandboxHandle[]): readonly SandboxEndpoint[] {
  return handles.map((handle) => {
    const endpoint = handle.endpoints.get('http');
    if (endpoint === undefined) {
      throw new Error('Missing requested HTTP endpoint');
    }
    return endpoint;
  });
}

async function verifyIndependentResponses(input: {
  readonly context: ProofContext;
  readonly endpoints: readonly SandboxEndpoint[];
}): Promise<readonly string[]> {
  const identities = await Promise.all(
    input.endpoints.map((endpoint) =>
      readIdentity({ url: new URL(`http://${endpoint.host}:${endpoint.port}/`) }),
    ),
  );
  assert.deepEqual(identities, input.context.sandboxIds);
  return identities;
}

async function verifyContainerExecution(context: ProofContext): Promise<void> {
  const results = await Promise.all(
    context.handles.map((handle) =>
      handle.execute({
        kind: 'container-exec',
        service: 'echo',
        argv: ['sh', '-c', 'printf "%s" "$SANDBOX_ID"'],
      }),
    ),
  );
  assert.deepEqual(
    results,
    context.sandboxIds.map((sandboxId) => ({
      kind: 'exited',
      service: 'echo',
      exitCode: 0,
      stdout: sandboxId,
      stderr: '',
      combined: sandboxId,
    })),
  );
}

async function verifyDockerResources(input: {
  readonly context: ProofContext;
  readonly ports: readonly number[];
}): Promise<readonly ContainerInspection[]> {
  const returnedIds = input.context.handles
    .map((handle) => handle.getContainer({ service: 'echo' }).testcontainer.id)
    .sort();
  const returnedPorts = input.context.handles.map((handle) => {
    const port = handle.getContainer({ service: 'echo' }).testcontainer.mappedPorts.get(80);
    if (port === undefined) {
      throw new Error('Sandbox container facade omitted requested port');
    }
    return port;
  });
  assert.deepEqual(sortedNumbers(returnedPorts), sortedNumbers(input.ports));
  const live = await resourcesForProjects({ projectNames: input.context.projectNames });
  assert.equal(live.containers.length, 5);
  assert.equal(live.networks.length, 5);
  assert.equal(live.volumes.length, 5);
  assert.deepEqual(
    returnedIds.map((id) => id.slice(0, 12)),
    [...live.containers].sort(),
  );
  const [containers, networks, volumes] = await Promise.all([
    inspectContainers({ ids: live.containers }),
    inspectNamedResources({ kind: 'network', names: live.networks }),
    inspectNamedResources({ kind: 'volume', names: live.volumes }),
  ]);
  assert.deepEqual(
    containers.map((item) => item.Config.Labels['com.docker.compose.project']).sort(),
    [...input.context.projectNames].sort(),
  );
  assert.equal(
    containers.every((item) => item.State.Running),
    true,
  );
  assert.deepEqual(
    sortedNumbers(containers.map((item) => inspectedHostPort({ container: item }))),
    sortedNumbers(input.ports),
  );
  assert.equal(networks.length, 5);
  assert.equal(volumes.length, 5);
  return containers;
}

export async function stopProof(context: ProofContext): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  const stops = await Promise.allSettled(
    context.handles.map((handle) => handle.stop({ reason: 'completed' })),
  );
  for (const result of stops) {
    if (result.status === 'rejected') {
      failures.push(result.reason);
    }
  }
  const residual = await resourcesForProjects({ projectNames: context.projectNames });
  if (residual.containers.length + residual.networks.length + residual.volumes.length > 0) {
    failures.push(new Error(`Proof-owned Docker resources remain: ${JSON.stringify(residual)}`));
  }
  return failures;
}

async function readIdentity(input: { readonly url: URL }): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(input.url, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.text()).trim();
    } catch (cause) {
      lastError = asError(cause);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error(`No response from ${input.url.href}`);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function sortedNumbers(values: readonly number[]): readonly number[] {
  return [...values].sort((left, right) => left - right);
}
