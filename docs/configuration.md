# Configure a system catalog

Blackbox reads `blackbox.config.yaml` from the project directory. The catalog names the system or subsystem to
acquire, its Compose files, participants, entrypoint, drivers, and observation configuration.

Start with the complete [subscription example catalog](../e2e/blackbox.config.yaml) and its
[Compose file](../e2e/.blackbox/catalog/subscription-system.yml). You can run this application with the [quickstart](getting-started.md). The schema is in
[blackbox-config-v1.json](../packages/catalog/schema/blackbox-config-v1.json).

## How the pieces fit together

The catalog connects three jobs: an acquisition adapter starts the environment, an activation adapter loads
instrumentation into application processes, and drivers prepare the commands you run against that environment.

| Component           | Question it answers                                                   |
| ------------------- | --------------------------------------------------------------------- |
| Acquisition adapter | How do I start this system?                                           |
| Instrumentation     | How does this process produce runtime observations?                   |
| Activation adapter  | How is that instrumentation loaded at startup?                        |
| Driver              | How does my command reach the target, and can it carry trace context? |

## Catalog fields

| Layer                                   | Responsibility                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion: 1`                      | Selects the catalog document contract.                                                                                                |
| `catalog.default` and `catalog.entries` | Name available systems and subsystems. Capsule startup currently requires an explicit `--system`.                                     |
| Entry `acquisition`                     | Selects `docker-compose@1` and ordered Compose files relative to the project.                                                         |
| Entry `participants`                    | Maps participant IDs to Compose services, roles, runtimes, and optional activation references.                                        |
| Entry `entrypoint`                      | Defines the participant, protocol, container port, and HTTP readiness check.                                                          |
| Entry `drivers`                         | Maps driver names to project modules, targets, execution locations, and propagation declarations.                                     |
| Entry `observation`                     | Declares the observation policy and boundaries. A declaration does not establish capture completeness or implement effect evaluation. |
| Root `activations`                      | Maps activation names to project-owned bootstrap files and adapters.                                                                  |

Compose describes how services run. The catalog describes how Blackbox selects and operates them. Referenced paths
must stay inside the project. Catalog validation also requires referenced Compose and activation files to exist.

## Reduce the system under test

Select the smallest boundary that can answer your question. Investigating payment validation need not start the
entire subscription application. Investigating whether subscription creation calls payment and saves an order does
need those participants, or explicit substitutes whose limits you understand.

The example catalog already offers both boundaries:

| Catalog entry         | Environment                                                               | Useful question                                           |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `subscription-system` | The subscription services and their dependencies.                         | How does subscription creation behave across services?    |
| `payment-mock`        | The example payment service in its own Compose environment.               | How does this payment fixture respond to a request?       |
| `payment-mock-dist`   | The payment service with locally built output mounted into its container. | How does my current compiled payment-service code behave? |

After the quickstart's project setup, select the smaller entry with the same Capsule workflow:

```sh
payment_start=$(blackbox capsule start --system payment-mock \
  --title 'Payment subsystem investigation' --json)
PAYMENT_SESSION_ID=$(printf '%s' "$payment_start" | jq -er '.sessionId')
PAYMENT_URL=$(printf '%s' "$payment_start" | jq -er '.entrypoint.url')

blackbox capsule exec --session "$PAYMENT_SESSION_ID" \
  --name 'Inspect payment readiness' --purpose inspection -- \
  curl --fail --silent --show-error "$PAYMENT_URL/health"

blackbox capsule stop --session "$PAYMENT_SESSION_ID" --json
```

This checks readiness of the selected subsystem; add the stimulus and checks for the behavior you want to investigate.
For your own application, add a catalog entry with the appropriate Compose files, participants, entrypoint/readiness,
activation, drivers, and observation policy. Keep Compose dependencies consistent with the reduced boundary.
`--system` selects a declared environment; it does not automatically infer or remove dependencies.

A smaller system usually means fewer competing causes and less setup, making feedback easier to interpret. The
finding is correspondingly scoped: a payment fixture succeeding alone does not verify the full checkout integration.
Expand the boundary when the claim needs cross-service behavior.

## Configure drivers and Node activation

The example's `public-api` driver prepares a host `curl` command with the mapped endpoint and W3C trace headers.
Its `postgres` and `redis` drivers select execution inside their participant containers and explicitly declare that
shared-state propagation is unsupported. Driver source remains project-owned under `.blackbox/drivers/`.

A driver needs its SDK installed alongside the project modules; see [driver installation](installation.md#install-the-sdk-for-project-drivers).
The guided demo prepares the included drivers and their dependencies automatically.
Plain host commands, as used in the quickstart, do not need a driver. Protocol tools such as `curl`, `psql`, and
`redis-cli` must be available where the command runs.

Read [drivers and command execution](drivers.md) for targets, execution locations, and propagation outcomes.

For Node applications, `blackbox inst install --runtime node` creates the standalone bootstrap and installs its
dependencies under `.blackbox/instrumentation/`. The example's `sut-node-factory` activation references that file
using `adapter: node-preload` and `version: 1`; participants opt in by naming the activation.

Installation, activation, and receiving telemetry are separate steps. An existing edited managed instrumentation
file is reported as a conflict rather than overwritten. See the [CLI package](../packages/cli/README.md) for
standalone CommonJS and ES module activation instructions. For Capsule configuration,
[Instrumentation and activation adapters](instrumentation.md) explains how to select `node-preload` or `node-esm`
and check that the configured processes are emitting observations.

## Validate before starting

With the built CLI selected and the current directory set to the configured project:

```sh
blackbox catalog validate --json
blackbox catalog list --json
```

A successful validation returns `ok: true`. Listing returns catalog entries without acquiring Docker resources.
For the included application, install instrumentation as shown in the quickstart before validation.
Starting the application and receiving observations are separate steps.

Next, follow the [subscription investigation](experiments.md) to see configuration, execution, and observation together.
