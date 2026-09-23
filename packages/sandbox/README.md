# Sandbox

`@suites/blackbox-sandbox-internal` is Blackbox's catalog-independent Docker
Compose runtime. A caller supplies already-resolved Compose inputs. This package
validates those inputs, records admission before Docker is touched, starts the
requested services through Testcontainers, resolves explicitly requested
endpoints, and performs bounded idempotent cleanup.

It does not read `blackbox.config.yaml`, discover catalogs, execute user
commands, or implement telemetry, instrumentation, Playwright, effects, or
assurance.

```ts
import { startSandbox } from '@suites/blackbox-sandbox-internal';

const sandbox = await startSandbox({
  sandbox: {
    sandboxId: 'orders-discovery-01',
    projectDirectory: '/absolute/path/to/project',
    composeFiles: ['.blackbox/catalog/orders.compose.yaml'],
    recordDirectory: '/absolute/path/to/project/.blackbox/runs/sandboxes',
    environment: { FEATURE_MODE: 'discovery' },
    serviceSelection: { kind: 'selected', services: ['orders', 'postgres'] },
    endpoints: [{ name: 'orders-http', service: 'orders', containerPort: 3000 }],
    startupTimeoutMs: 60_000,
    stopTimeoutMs: 30_000,
  },
  progress: {
    kind: 'events',
    sink: { emit: (event) => console.error(`[blackbox] ${event.kind}`) },
  },
});

console.log(sandbox.endpoints.get('orders-http'));
console.log(sandbox.getContainer({ service: 'orders' }).testcontainer.labels);
console.log(sandbox.inspectResources({ kind: 'owned-compose-resources' }));
const result = await sandbox.execute({
  kind: 'container-exec',
  service: 'postgres',
  argv: ['psql', '--version'],
});
await sandbox.stop({ reason: 'completed' });
```

Records are atomically replaced, but this first slice does not claim fsync or
power-loss durability. Use `findInterruptedSandboxes()` after restart to expose
records which were admitted but never reached a terminal state.

Lifecycle callbacks run only after the corresponding record is persisted. They
are best-effort presentation hooks; the record remains authoritative if a
callback throws.

The returned sandbox exposes immutable snapshots of the caller-supplied Compose
environment, requested endpoints, and explicitly selected/requested containers.
Each container has a `testcontainer` inspection facade for identity, labels,
networks, host, and mapped ports. It deliberately has no `exec`, copy, restart,
stop, or other mutation capability. The environment snapshot is only the
Compose substitution environment supplied by the caller; it does not claim to
describe image-internal environment variables.

Resource inspection reports only containers selected by the caller and networks
and volumes observed with the exact Compose project label. It does not expose a
Docker client or any resource mutator. Progress is explicitly silent or emitted
through a sink; sink failures cannot change acquisition or cleanup results.

Run `pnpm --dir packages/sandbox test:docker` to opt into the bounded Docker
proof. It starts five isolated Compose projects concurrently, validates their
dynamic ports and responses against Docker inspection, then requires every
proof-owned container, network, and volume to be gone.

During Compose startup, progress sinks receive exact-project Docker observations
before `up()` resolves: container state, Docker health, exit code, and discovered
networks/volumes. Polling runs every 500ms, emits changed facts and a waiting event
every five seconds, and aborts when acquisition succeeds or fails. Docker health
is not application readiness. Fast intermediate states between polls may be
missed; image pull/build progress is not claimed. Inspection outages emit an
explicit unavailable event and recovery notification without changing acquisition.
