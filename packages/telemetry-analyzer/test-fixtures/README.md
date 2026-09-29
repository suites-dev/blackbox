# Effect normalization fixtures

Each case directory holds:

- `input.json`: the scope and the retained OTLP fragments, each stored as a parsed
  `request` object with one span per line for readable diffs. The golden harness
  re-serializes every request with `JSON.stringify` to form the raw JSON text the
  normalizer consumes, so `inputs[].sha256` digests the fixture's serialization, not
  the originally retained bytes. The production path hashes the retained bytes.
- `expected.effectset.json`: the expected EffectSet, as its RFC 8785 canonical bytes
  rendered with 2-space indentation plus a trailing newline. The test checks both the
  canonical bytes and this exact rendering. This directory is excluded from Prettier.

Goldens are written only by
`node scripts/capture-fixture.mjs expected --case <dir>` (or `capture ... --write-expected`)
after `pnpm build`, and every changed line is reviewed before commit.

## `subscription/` (real capture)

One run of the bundled subscription system through the packed Capsule CLI.

| Field              | Value                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Captured           | 2026-09-29, Linux (WSL2), Docker Engine                                                                |
| Source commit      | `3dc7e7180fe90ef5b36b42230d9f53b88f45df4a` (`release/v0.0.1-alpha`)                                   |
| CLI                | packed `@suites/blackbox-cli@0.0.0` from `bash e2e/bash/capsule-assets.sh` at that commit              |
| SUT                | images built by Capsule from `e2e/sut` at that commit (`pg@8.16.3`, `redis@4.7.1`, `@aws-sdk/client-sqs@3.1140.0`) |
| Dependencies       | `postgres:16-alpine` `75f5a96988cd`, `redis:7-alpine` `f84b0c467801`, `localstack/localstack:3.8` `fdd514bd493f` |
| Instrumentation    | `auto-instrumentations-node@0.79.0`, `sdk-node@0.221.0` (http 0.221.0, undici 0.31.0, pg 0.73.0, redis 0.69.0, aws-sdk 0.76.0, net 0.65.0, dns 0.64.0) |
| Session            | `calm-workshop-jacob-046994408175`, 18 fragments, 144 spans                                            |

Commands, run from `e2e/` (`T` is a throwaway fixture token):

```bash
BB=$(jq -r .blackboxBin .blackbox/capsule-assets.json); T=fixture-token
$BB driver install --runtime node --json
$BB inst install --runtime node
S=$($BB capsule start --system subscription-system --title fx --description "effects corpus" --env FIXTURE_CONTROL_TOKEN=$T --json | jq -r .sessionId)
$BB capsule exec --session $S --name setup --driver public-api --purpose setup --json -- curl -fsS -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' --data '{"profile":"fresh"}' /fixture/reset
$BB capsule exec --session $S --name alice --driver public-api --purpose stimulus --json -- curl -fsS -X POST -H 'Content-Type: application/json' --data '{"userId":"alice","paymentMethodId":"pm_fx_alice"}' /subscriptions
$BB capsule exec --session $S --name redis --driver redis --purpose stimulus --json -- redis-cli RPUSH blackbox:proof:stimuli fx-1
# waited until redis-proof-consumer spans were retained
$BB capsule exec --session $S --name psql --driver postgres --purpose inspection --json -- psql --username fixture --dbname subscriptions -tAc "SELECT status FROM subscriptions WHERE user_id='alice'"
$BB capsule stop --session $S --json
cd ../packages/telemetry-analyzer
FIXTURE_CONTROL_TOKEN=$T node scripts/capture-fixture.mjs capture --project ../../e2e --session $S --out test-fixtures/subscription
node scripts/capture-fixture.mjs expected --case test-fixtures/subscription
```

Scrubbing (done by `capture-fixture.mjs` before writing):

- Resource attributes removed from every fragment: `host.*`, `os.*`, `container.id`,
  `process.command_args`, `process.executable.path`. None affects classification.
- Span attributes are not edited.
- The script fails if the `FIXTURE_CONTROL_TOKEN` value, a `Bearer ` credential, or
  the word `authorization` appears anywhere in the written files.

`capture-context.json` keeps allow-listed facts of the same run for later linkage and
capture-status fixtures: session state, each activity's id, name, purpose, target,
kind, trace id and propagation outcome, and each collector run's receiver, shutdown,
failure and activations. Activity argv, environment and outputs are not copied.

Activities in this run:

| Activity | Purpose    | Driver     | Trace id prefix | Propagation             |
| -------- | ---------- | ---------- | --------------- | ----------------------- |
| setup    | setup      | public-api | `8d11d7c2`      | `context-injected`      |
| alice    | stimulus   | public-api | `cf2458fb`      | `context-injected`      |
| redis    | stimulus   | redis      | `f27215dc`      | `context-not-supported` |
| psql     | inspection | postgres   | `5b52098f`      | `context-not-supported` |

Known facts of the retained run that later rules must handle:

- The collector lifecycle record retained after `capsule stop` says
  `receiver: draining, shutdown: draining`. The final `stopped/complete` revision was
  left in an unrenamed `collector-lifecycle.json.*.tmp` file even though the stop
  reported `cleanup: complete`. `capture-context.json` records the retained record
  verbatim.
- The readiness probe (`GET /health` on public-api, unlinked) fans out to the
  `/health` of fraud-check, order-service and payment-mock, and those run
  `GetQueueUrl`, `SELECT 1` and `PING` against their dependencies.
- The setup reset drains the queue: 8 `SQS.GetQueueAttributes` and 7
  `subscription-orders receive` spans in the setup trace.

## `synthetic/` (hand-written)

| Case                   | Covers                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `duplicate-delivery`   | #31 fixture (d): the same client span in fragments 1 and 2 is one occurrence, `deliveries: [1,2]` |
| `two-real-occurrences` | #31 fixture (c), span level: two server spans with identical attributes count 2                  |
| `unknown-span`         | #31 fixture (g): a custom-scope INTERNAL span is kept as `unclassified`                           |
| `conflicting-delivery` | the same span id delivered twice with a different status becomes a limitation                    |
