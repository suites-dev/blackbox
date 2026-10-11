# Configure a system boundary

`blackbox.config.yaml` selects the application and dependencies Blackbox starts.
Keep it at your test-project root. The [first-test tutorial](getting-started.md#2-declare-the-system)
contains a complete minimal example.

## Catalog fields

| Field                       | Meaning                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `schemaVersion`             | Must be `1`.                                                                          |
| `catalog.default`           | ID of the default entry.                                                              |
| `catalog.entries.<id>.kind` | `system` or `subsystem`; must match the test's selector.                              |
| `acquisition.adapter`       | `docker-compose@1`.                                                                   |
| `acquisition.files`         | Ordered project-relative Compose files.                                               |
| `entrypoint`                | Participant, HTTP/HTTPS protocol, container port, and readiness path/timeout.         |
| `participants`              | Catalog name to Compose service, role, runtime, and optional activation.              |
| `drivers`                   | Named project-owned command drivers; `{}` when unused.                                |
| `observation`               | Declared observation boundaries, requirements, terminal window, and redaction policy. |
| Top-level `activations`     | Optional instrumentation assets referenced by participants.                           |

The [JSON Schema](../packages/catalog/schema/blackbox-config-v1.json) is the
complete field reference, including required fields and allowed values.
[Catalog semantics](../packages/catalog/README.md) cover loading and path validation.
Declaring an observation boundary does not install an observer or prove coverage.

## Select the entry from a test

```ts
test.system('orders', (system) => {
  system.sandbox('default', (suite) => {
    // Declare tests for the catalog entry with kind: system and ID: orders.
  });
});
```

Use `test.system({ kind: 'subsystem', id: 'payments' }, ...)` for a subsystem.
The string `default` names a test configuration group; it does not select
`catalog.default` or create a shared live Sandbox.

## Adapt Compose and readiness

Use project-relative files and declare the entrypoint's container port in the catalog.
Blackbox publishes requested endpoints and resolves their mapped host addresses.
Leave host port publication out of the tutorial Compose file. Include all participants
needed for the behavior and its observations. Keep application migrations and
seed data in your startup or test preparation.

Readiness establishes that the application can accept the test. It does not
replace a business assertion. Make `/health` reflect the dependencies the test
needs before declaring the system ready.

## Validate before execution

From the application root, with a selected Catalog CLI provider:

```sh
npx blackbox catalog validate --json
npx blackbox catalog ls --json
```

Validation checks YAML/schema, semantic references, referenced files,
and compatibility with registered activation adapters. It does not execute
Compose, migrations, or readiness probes.

[Connect an application](playwright/connect-your-application.md) ·
[Instrumentation package](../packages/instrumentation-runtime-node/README.md) ·
[Drivers](drivers.md)
