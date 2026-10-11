# Run commands through project drivers

A Capsule driver prepares a command for the running system. It can resolve the
target endpoint, supply connection settings, choose host or participant execution,
and inject supported trace context. Your command still supplies the action.

Use plain `capsule run` when the host command already has a complete address and
all connection information. Use `--via <driver-name>` for a catalog-defined driver.

## Prepare a driver

Install the [Driver SDK](installation.md#install-the-sdk-for-project-drivers)
and create the project's driver module. The [Driver SDK reference](../packages/driver/README.md)
describes its public API. Working modules in this checkout include
[HTTP](../e2e/.blackbox/drivers/public-api.mjs),
[PostgreSQL](../e2e/.blackbox/drivers/postgres.mjs), and
[Redis](../e2e/.blackbox/drivers/redis.mjs).

Declare the module under `catalog.entries.<id>.drivers`. This fragment selects a
participant named `api` for a driver named `public-api`:

```yaml
public-api:
  kind: project-driver
  runtime: node
  ref: .blackbox/drivers/public-api.mjs
  target:
    kind: participant
    participant: api
    protocol: http
    containerPort: 3000
  execution:
    kind: host
  propagation:
    kind: w3c-trace-context-propagation
    carrier: http-headers
```

The participant and module must exist. A named driver definition must match its
catalog key. This is a configuration fragment; use the
[Catalog schema](../packages/catalog/schema/blackbox-config-v1.json) for the enclosing fields.

## Run and inspect

With that driver configured and a Capsule running:

```sh
npx blackbox capsule run --session <session-id> --via public-api --purpose stimulus -- \
  curl --fail --silent --show-error /health
```

The HTTP driver resolves the target and can inject a `traceparent` header. The
result records preparation, propagation, command output, and exit status. Inspect
received spans separately; header injection alone does not prove downstream tracing.

Host tools must be installed on the host. Participant tools must exist in that
container image. Installing the Driver SDK does not install `curl`, `psql`, or `redis-cli`.

## Distinguish propagation outcomes

| Outcome                 | Meaning                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `context-injected`      | The driver placed context in the declared carrier.                                      |
| `context-not-injected`  | Required injection failed; execution needs an explicit `--allow-untraced` override.     |
| `context-not-supported` | The declared boundary cannot carry this context, as in the sample shared-state drivers. |

Keep credentials out of shared command output; driver redaction metadata does
not sanitize arbitrary text emitted by a tool. A database read can establish
observed state even when trace continuity is unavailable.

[Capsule experiments](guides/investigate-with-capsule.md) ·
[Configuration](configuration.md) · [Evidence](concepts/behavioral-evidence.md)
