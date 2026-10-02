import type { ComposeContainer, StartedComposeSandbox } from '../model/compose.js';
import type { SandboxEndpoint } from '../model/handle.js';
import type {
  SandboxContainer,
  SandboxMappedPortSelector,
  SandboxTestcontainerInspection,
} from './sandbox-container.js';
import type { SandboxEndpointRequest, SandboxInput } from '../model/input.js';

class ImmutableMapView<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly [Symbol.toStringTag] = 'ReadonlyMap';
  readonly #snapshot: ReadonlyMap<Key, Value>;

  constructor(source: ReadonlyMap<Key, Value>) {
    this.#snapshot = new Map(source);
  }

  get size(): number {
    return this.#snapshot.size;
  }

  has(key: Key): boolean {
    return this.#snapshot.has(key);
  }

  get(key: Key): Value | undefined {
    return this.#snapshot.get(key);
  }

  forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void): void {
    this.#snapshot.forEach((value, key) => {
      callback(value, key, this);
    });
  }

  entries(): MapIterator<[Key, Value]> {
    return this.#snapshot.entries();
  }

  keys(): MapIterator<Key> {
    return this.#snapshot.keys();
  }

  values(): MapIterator<Value> {
    return this.#snapshot.values();
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.#snapshot[Symbol.iterator]();
  }
}

export function immutableMap<Key, Value>(source: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  return Object.freeze(new ImmutableMapView(source));
}

export function inspectableContainer(input: {
  readonly service: string;
  readonly container: ComposeContainer;
  readonly endpoints: readonly SandboxEndpointRequest[];
}): SandboxContainer {
  const mappedPorts = new Map<number, number>();
  for (const endpoint of input.endpoints) {
    if (endpoint.service === input.service) {
      mappedPorts.set(
        endpoint.containerPort,
        input.container.getMappedPort({ containerPort: endpoint.containerPort }),
      );
    }
  }
  const inspection = createInspection({ container: input.container, mappedPorts });
  return Object.freeze({ service: input.service, testcontainer: inspection });
}

function createInspection(input: {
  readonly container: ComposeContainer;
  readonly mappedPorts: ReadonlyMap<number, number>;
}): SandboxTestcontainerInspection {
  return Object.freeze({
    id: input.container.id,
    name: input.container.name,
    host: input.container.host,
    labels: Object.freeze({ ...input.container.labels }),
    environment: Object.freeze({ ...input.container.environment }),
    networkNames: Object.freeze([...input.container.networkNames]),
    mappedPorts: immutableMap(input.mappedPorts),
    getMappedPort: (selector: SandboxMappedPortSelector) => input.container.getMappedPort(selector),
  });
}

interface StartedSandboxInput {
  readonly input: SandboxInput;
  readonly compose: StartedComposeSandbox;
}

/** Resolves every requested endpoint to the host and port Compose mapped it to. */
export function requestedEndpoints(
  input: StartedSandboxInput,
): ReadonlyMap<string, SandboxEndpoint> {
  const endpoints = new Map<string, SandboxEndpoint>();
  for (const request of input.input.endpoints) {
    const container = input.compose.getContainer({ service: request.service });
    endpoints.set(
      request.name,
      Object.freeze({
        ...request,
        host: container.host,
        port: container.getMappedPort({ containerPort: request.containerPort }),
      }),
    );
  }
  return endpoints;
}

/** Inspects the container of every selected service. */
export function selectedContainers(
  input: StartedSandboxInput,
): ReadonlyMap<string, SandboxContainer> {
  const selection = input.input.serviceSelection;
  const services = selection.kind === 'selected' ? selection.services : selection.declaredServices;
  const containers = new Map<string, SandboxContainer>();
  for (const service of services) {
    containers.set(
      service,
      inspectableContainer({
        service,
        container: input.compose.getContainer({ service }),
        endpoints: input.input.endpoints,
      }),
    );
  }
  return containers;
}
