# Driver

`@suites/blackbox-driver` defines the command-driver contract and the current Node authoring runtime. A project driver turns a caller-supplied command plus resolved Capsule context into arguments, environment variables, telemetry propagation, and redaction declarations.

This is a private workspace package. It is not currently published as a supported npm dependency. For the end-user workflow, read [Drivers and command execution](../../docs/drivers.md); this page describes the maintainer boundary.

```text
CLI + catalog + Capsule context
             │ prepare request
             ▼
project driver in a bounded Node child process
             │ validated preparation
             ▼
Capsule executes the preserved executable on host or participant
             │
             ├─ retained activity and redacted process result
             └─ telemetry propagation record (not proof of downstream receipt)
```

## Package responsibilities

The package owns:

- authoring types and `defineDriver()` validation;
- versioned JSON request, response, and runtime-artifact schemas;
- preparation validation, including executable preservation, propagation consistency, and redaction coordinates;
- the Node runner that loads a project-owned module and exchanges one JSON response over standard I/O;
- preparation limits: five seconds and 1 MiB combined retained stdout/stderr.

It does not own:

- catalog selection, endpoint resolution, or module containment;
- installation of protocol tools such as `curl`, `psql`, or `redis-cli`;
- execution of the prepared command;
- activity retention, interactive I/O, process-result redaction, or telemetry collection;
- proof that an injected context reached or continued through the target system.

Those boundaries keep drivers as adapters rather than project-specific actions. A driver may add connection data or tracing, but it must preserve the executable supplied by the caller.

## Author a Node driver

A project module default-exports a definition. Its `name` must match the selected catalog driver ID, and `prepare()` must return a complete preparation. This minimal adapter assumes its catalog entry declares `propagation-not-requested`:

```js
import { defineDriver } from '@suites/blackbox-driver';

export default defineDriver({
  kind: 'project-driver',
  name: 'public-api',
  prepare(request) {
    return {
      kind: 'prepared-command',
      argv: request.command.argv,
      environment: { API_URL: request.target.endpoint.url },
      propagation: { kind: 'context-not-injected', reason: 'driver-declared-none' },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'none' },
        environment: { kind: 'none' },
      },
    };
  },
});
```

`request` is cloned and deeply frozen before project code receives it. It contains the original command, resolved target and endpoint, execution location, expected propagation, and available telemetry context. The result is schema-checked and then checked against the request.

Use the working [HTTP](../../e2e/.blackbox/drivers/public-api.mjs), [PostgreSQL](../../e2e/.blackbox/drivers/postgres.mjs), and [Redis](../../e2e/.blackbox/drivers/redis.mjs) drivers for carrier injection, secret redaction, and shared-state examples. Keep full catalog and CLI instructions in the [user guide](../../docs/drivers.md), not here.

## Preparation and execution are separate

`prepareNodeProjectDriver()` generates a small ESM runner, starts the current Node executable with the project directory as its working directory, writes the request to stdin, and decodes one response from stdout. The runner imports the project's default export and calls `prepare()`; it never runs the prepared `argv`.

Capsule owns the next stage. It combines the validated preparation with Capsule-managed environment and telemetry state, enforces propagation policy, and starts the preserved executable either:

- on the host, with the project directory as its working directory; or
- in the catalog-selected participant container.

This ownership split is covered by [Node preparation](src/node-runner/preparation/node-project-driver.ts) and [Capsule driver execution](../capsule/src/execution/driver-execution.ts).

## Isolation and trust boundary

The Node runner is process isolation for bounded preparation, not a security sandbox. Project driver code can use Node capabilities, inherits the Blackbox process environment, runs from the project directory, and resolves its own project-local dependencies.

On timeout or excess protocol output, the runner forcibly terminates the child. On POSIX platforms it starts a detached process group and attempts to terminate descendants; on Windows the implementation terminates the direct child. Do not treat this as containment for untrusted driver code.

The protocol also limits what a successful preparation may claim:

| Check        | Enforced meaning                                                                        |
| ------------ | --------------------------------------------------------------------------------------- |
| Executable   | `prepared.argv[0]` equals the caller-supplied executable.                               |
| Propagation  | The outcome is compatible with the catalog expectation and carrier.                     |
| Shared state | An unsupported boundary preserves the expected resource name.                           |
| Redaction    | Argument positions exist and named secret keys are present in the prepared environment. |

A `context-injected` outcome records what the driver says it placed into a carrier. Runtime telemetry must still establish whether the application received and continued that context. A shared-state limitation records the missing direct trace link; it does not manufacture correlation.

Redaction declarations tell Capsule which prepared values are secret, including values to remove from retained or streamed output. Undeclared sensitive output cannot be recognized automatically.

## Integration points

| Consumer                                                | Integration                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Catalog](../catalog/src/model/catalog-types.ts)        | Declares project module, target, execution location, and propagation expectation.                                      |
| [Capsule](../capsule/src/execution/driver-execution.ts) | Builds the request, invokes preparation, enforces propagation policy, and owns command execution.                      |
| [CLI install](../cli/src/commands/driver/install.ts)    | Prepares `.blackbox/drivers/` and verifies a project-local SDK; it does not author a driver or install protocol tools. |
| [CLI exec](../cli/src/commands/capsule/exec.ts)         | Selects the driver and exposes the explicit `--allow-untraced` override.                                               |
| [Telemetry](../telemetry/src/index.ts)                  | Supplies propagation expectations/outcomes used to validate and retain the boundary record.                            |

The root export in [src/index.ts](src/index.ts) exposes the authoring model, protocol helpers, schemas, runtime artifact, and Node preparation helpers. The `./node-runner` subpath is the generated child-process entrypoint. The checked-in schemas under [schema](schema/) are the versioned wire contract for tooling or a future non-Node runner; only the Node runtime is implemented today.

## Maintainer workflow

Run package checks from the repository root with the pinned workspace toolchain:

```sh
pnpm --filter @suites/blackbox-driver lint
pnpm --filter @suites/blackbox-driver build
pnpm --filter @suites/blackbox-driver test
```

`test` runs `pretest`, so it rebuilds before Vitest. When changing a protocol shape, update the TypeScript model, JSON schema, decoding/validation tests, and Capsule consumers together. When changing runner termination or process behavior, verify the exact child and descendant cleanup cases rather than relying only on a successful exit.
