# Drivers and command execution

A driver prepares a command for a Capsule's running environment. It can resolve an endpoint, add connection settings
or trace headers, and arrange execution where the tool is available. You still supply the action: the URL, SQL query,
or Redis command you want to run.

```text
Your command + selected driver
  → resolved target and execution location
  → prepared arguments, environment, and propagation outcome
  → command runs
  → activity result + separately collected runtime observations
```

Use plain `capsule exec` for a host command that already has everything it needs. Add `--driver <name>` when a
configured driver should prepare it.

## Choose where the command runs

The subscription example illustrates these choices:

| Execution             | Tool runs in               | What Blackbox or the driver supplies                                                           |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| No driver             | Your host                  | Activity recording; you provide a complete command and address.                                |
| `--driver public-api` | Your host                  | The HTTP endpoint and a W3C `traceparent` header for `curl`.                                   |
| `--driver postgres`   | The PostgreSQL participant | Connection environment for `psql`, including a password marked for redaction.                  |
| `--driver redis`      | The Redis participant      | Execution in the selected Redis container and an explicit shared-state propagation limitation. |

The driver names come from the project's catalog. They are example modules, not globally installed protocol commands.
The tool must exist where it runs: host execution needs host `curl`; participant execution needs `psql` or `redis-cli`
in that participant's image. `driver install` installs the driver SDK, not these programs.

## Prepare project drivers

Driver modules live with the application, usually under `.blackbox/drivers/`. The command below prepares that
directory, its runtime metadata, and its SDK dependency while preserving project source and existing dependencies:

```sh
blackbox driver install --runtime node --json
```

For the alpha source distribution, complete the [local SDK installation](installation.md#install-the-sdk-for-project-drivers)
before running this command. The guided demo prepares its own local dependencies automatically.

Installing the SDK does not choose a target or author a driver. The project owns those declarations and modules.

## Declare a target and execution location

This entry belongs under `catalog.entries.<system>.drivers` in `blackbox.config.yaml`:

```yaml
public-api:
  kind: project-driver
  runtime: node
  ref: .blackbox/drivers/public-api.mjs
  target:
    kind: participant
    participant: public-api
    protocol: http
    containerPort: 3000
  execution:
    kind: host
  propagation:
    kind: w3c-trace-context-propagation
    carrier: http-headers
```

`target` identifies the participant and endpoint the command communicates with. `execution` selects where the command
runs. A host command uses the mapped address; a participant command runs inside the container selected by its
`execution.participant`. These are separate choices.

For example, the PostgreSQL driver uses:

```yaml
execution:
  kind: participant
  participant: postgres
propagation:
  kind: shared-state-propagation-unsupported
  resource: postgresql
```

This is part of a driver declaration, not a complete configuration. See the
[example catalog](../e2e/blackbox.config.yaml) for all required fields.

## Send a traced HTTP request

With the example drivers prepared and a Capsule running:

```sh
blackbox capsule exec \
  --session "$SESSION_ID" \
  --name 'Create Alice subscription' \
  --driver public-api \
  --purpose stimulus \
  --json -- \
  curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"userId":"alice","paymentMethodId":"pm_capsule_alice"}' \
  /subscriptions
```

The HTTP driver expands `/subscriptions` against the running participant's endpoint and injects a `traceparent`
header. The instrumented service can continue that trace. The result includes the activity ID, process result,
and propagation expectation/outcome; `context-injected` records the driver's injection result.

Injection alone does not prove that every downstream service propagated or exported spans. Use the activity and
trace queries in the [walkthrough](experiments.md) to inspect what actually arrived.

## Seed data and run migrations

Drivers are useful throughout a trial. Use them to prepare initial conditions, trigger the behavior, and inspect
its outcome. A `psql` command can create schema, apply migrations, seed records, or read state; an HTTP command can
call an application setup endpoint; a Redis command can put work onto a queue.

For example, with the subscription Capsule running, seed a new example user before sending a request for that user:

```sh
blackbox capsule exec --session "$SESSION_ID" \
  --name 'Seed a subscription customer' --driver postgres --purpose setup -- \
  psql --username fixture --dbname subscriptions --set ON_ERROR_STOP=1 \
  --command "INSERT INTO users (user_id, tier, execution_path) VALUES ('docs-customer', 'pro', 'full') ON CONFLICT (user_id) DO NOTHING;"
```

This uses the example's existing `users` schema. It establishes a customer, not an active subscription; the later
subscription request is the stimulus. Inspect the starting row when its exact values matter, since `ON CONFLICT`
leaves an existing row unchanged.

For your own application, the same driver can run a SQL migration file. The following pattern assumes you have
mounted your migration at `/migrations/001-init.sql` **inside the PostgreSQL participant** and that it targets the
configured database:

```sh
blackbox capsule exec --session "$SESSION_ID" \
  --name 'Apply database migration' --driver postgres --purpose setup -- \
  psql --username fixture --dbname subscriptions --set ON_ERROR_STOP=1 \
  --file /migrations/001-init.sql
```

That file is application-owned and is not part of the example. A host file path is not automatically copied into a
participant. If your migration tool runs in an application container instead, give it a driver configured for that
execution location and its required database connection. Blackbox records the command and result; the tool owns
migration ordering and schema changes. `ON_ERROR_STOP` makes `psql` stop on SQL errors, but does not wrap an entire
file in a transaction.

Use `--purpose setup` to make preparation recognizable in the retained activity record. Purpose labels do not change
command semantics or provide rollback. See [async holes](async-workflows.md) for using Redis as the stimulus itself.

## Inspect database state

```sh
blackbox capsule exec \
  --session "$SESSION_ID" \
  --name 'Inspect Alice subscription' \
  --driver postgres \
  --purpose inspection -- \
  psql --username fixture --dbname subscriptions \
  --tuples-only --no-align \
  --command "SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';"
```

After the example's subscription request succeeds, the query returns `alice|active`. The driver leaves the supplied
`psql` arguments intact, supplies connection settings, and marks `PGPASSWORD` for redaction in retained driver data.
Review command output separately before sharing it; a driver's redaction declaration does not sanitize arbitrary
output from your tool.

The query records observed database state and can support a state claim for this execution. Trace continuity is not
required for that use; the result does not identify the particular transaction that created the state.

## Understand propagation outcomes

| Outcome                 | Meaning                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `context-injected`      | The driver reports that it placed context into the declared carrier. Inspect received spans to verify downstream correlation. |
| `context-not-injected`  | Expected context was not injected. Execution is refused unless you explicitly use `--allow-untraced`.                         |
| `context-not-supported` | The driver declares a boundary, such as shared state, that does not carry this context. The limitation remains in the result. |

The PostgreSQL and Redis examples declare shared-state propagation as unsupported. They can execute normally without
pretending to provide a trace link. `--allow-untraced` is for explicitly accepting an unmet propagation expectation;
it does not repair or create correlation.

A Redis command can cause a worker to run later on another trace. That observation remains evidence within the
execution. Known initial state, exclusive input, and an observed business identifier may support a behavioral claim
across those traces, without establishing a direct span-to-span causal link. Read [runtime evidence](runtime-evidence.md)
for the distinction. The extended guided demo also exercises this case.

## Author a project driver

A Node module exports a definition created with `defineDriver` from `@suites/blackbox-driver`. Its `prepare(request)`
receives the command, resolved target, execution location, and available telemetry context. It returns:

- `argv` and `environment` for the prepared command;
- a `propagation` outcome describing the context actually supplied;
- `redaction` declarations for sensitive argument positions and environment keys.

Blackbox validates the preparation and runs the command. Start from the example
[HTTP driver](../e2e/.blackbox/drivers/public-api.mjs),
[PostgreSQL driver](../e2e/.blackbox/drivers/postgres.mjs), or
[Redis driver](../e2e/.blackbox/drivers/redis.mjs).
A driver prepares an action; [instrumentation](instrumentation.md) makes the application's runtime behavior observable.
