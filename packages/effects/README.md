# Blackbox Effects

`@suites/blackbox-effects` turns OpenTelemetry trace exports into immutable effects
and evaluates behavioral contracts. It has no runtime dependencies and works
without Playwright, a collector, or a Blackbox sandbox.

This alpha package accepts decoded OTLP JSON trace export payloads. The caller
chooses which observations belong together and supplies their scope identifier.

```ts
import { readFile } from 'node:fs/promises';
import { compileEffectContract, evaluateEffects, projectEffects } from '@suites/blackbox-effects';

const payload = JSON.parse(await readFile('./traces.json', 'utf8'));
const graph = projectEffects({
  format: 'otlp-json',
  scopeId: 'checkout-42',
  payloads: [payload],
});
const contract = compileEffectContract((e) => [
  e.exists(e.db({ operation: 'INSERT' })),
  e.exists(e.message({ operation: 'send', destination: 'orders' })),
]);
const assessment = evaluateEffects(graph, contract);

console.log(graph.effects);
console.log(assessment.status, assessment.findings);
```

The assessment passes when both operations are observed with matching fields.
Missing evidence remains `inconclusive`. An effect records an observed operation;
checking durable database or cache state requires a separate read from that system.

## Public API

| Function                | Input                                        | Output                                                                                  |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `projectEffects`        | `{ format: 'otlp-json', scopeId, payloads }` | `EffectGraph` with effects, source span identities, relations, and coverage diagnostics |
| `compileEffectContract` | Builder callback returning constraints       | Canonical, serializable `EffectContract`                                                |
| `evaluateEffects`       | Graph and contract                           | `EffectAssessment` with status and per-constraint findings, reasons, and evidence IDs   |

The package also exports `effectContractBuilder` and the graph, selector, builder,
contract, and assessment types through its root entrypoint. Its internal modules
are not public entrypoints.

All three functions are synchronous. They snapshot their inputs and deeply freeze
their outputs without freezing caller-owned data. Invalid JSON shapes, conflicting
observations, or malformed graph/contract structures throw `TypeError`. Valid
observations with missing semantic evidence produce uncertainty instead.

`projectEffects` accepts inert decoded telemetry. It rejects enumerable accessors,
accessor array elements, and proxies without invoking their getters or traps.
Parse serialized OTLP JSON before projection; application objects are not telemetry.
Trusted contract construction retains its existing accessor snapshot behavior.
Duplicate trace/span identities must also agree on resource, instrumentation scope
and schema metadata. Conflicting provenance rejects the projection atomically;
matching observations under different producer contexts are not silently merged.
Unknown OTLP message fields are ignored before comparison.

The current graph schema is `0.1.1`, the contract schema is `1`, and assessment
semantics are `0.1.0`. These are separate versioned data formats.

## Write contracts

Selectors include `http`, `rpc`, `db`, `cache`, `message`, `business`, `internal`,
and `span`. Common fields are `operation`, `target`, `actor`, `outcome`, and `where`.
Convenience aliases include HTTP `method`/`route`, RPC `service`, database `table`,
cache `keyspace`, and message `destination`.

Constraints include `exists`, `absent`, `exactly`, `atLeast`, `atMost`, `before`,
and `after`. The projection currently recognizes structured HTTP, RPC, database,
cache, and messaging observations; the presence of a selector does not imply that
the projector can infer that kind from every telemetry source.

| Evidence                                                                     | Result                               |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| A required effect is observed                                                | `pass` for that existence constraint |
| A forbidden effect is observed                                               | `fail` for that absence constraint   |
| A required effect has not been observed in an open capture                   | `inconclusive`                       |
| An exact count matches observed effects, but capture completeness is unknown | `inconclusive`                       |
| Trace parent/link relationships exist, but ordering evidence is insufficient | `inconclusive` for ordering          |

## Supply evidence with explicit boundaries

Projection always returns an open graph. `scopeId` labels the caller's selection;
it does not authenticate or filter telemetry. Collecting, admitting, and isolating
observations belongs to the consumer.

Projection does not infer operations from SQL text or span display names. Database
namespaces do not become table names, and Redis key targets remain unknown without
a supported convention. Parent links and timestamps do not become
`happensBefore` proof.

`evaluateEffects` also accepts a conforming caller-created graph. Completeness and
ordering metadata in that graph are the caller's attestation. Shape validation
cannot certify that the underlying capture was complete or the ordering true.

The [Playwright package](../playwright/README.md) owns activity selection, test
lifecycle, and `expect(...).toSatisfy(...)`. Its matcher uses this package's public
API. Other consumers can use the assessment directly or provide their own adapter.

## OpenTelemetry standards profile

The input is an OTLP JSON `ExportTraceServiceRequest`, not an SDK `Span` object.
An SDK span exposes recording methods; this package reads exported observations.
No OpenTelemetry SDK is required in the consuming test process.

The reader follows [OTLP JSON encoding](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding)
and the [ProtoJSON presence and null rules](https://protobuf.dev/programming-guides/json/).
The supported message fields are pinned to
[opentelemetry-proto b3f7558](https://github.com/open-telemetry/opentelemetry-proto/tree/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto).
The attribute names and key renames use
[semantic conventions v1.44.0](https://github.com/open-telemetry/semantic-conventions/tree/e10a930844c6951757a43b849d364f7d056ac32b)
and its [published schema changes](https://github.com/open-telemetry/semantic-conventions/blob/e10a930844c6951757a43b849d364f7d056ac32b/schemas/1.44.0).

| Exported observation                          | Interpretation                             |
| --------------------------------------------- | ------------------------------------------ |
| `{}` or omitted/null repeated fields          | Empty observations; capture remains open   |
| Uppercase or lowercase trace/span hex         | Canonical lowercase identity               |
| Numeric status code `2`                       | Observed failure                           |
| Unset, OK, or an unknown numeric status code  | Unknown effect outcome                     |
| Enum name strings such as `STATUS_CODE_ERROR` | Rejected; OTLP uses numeric enums          |
| Unknown message fields                        | Ignored, including inside attribute values |
| Empty or unset semantic strings               | No usable evidence for that field          |

Supported key renames preserve values:

| Legacy attribute        | Current attribute            |
| ----------------------- | ---------------------------- |
| `http.method`           | `http.request.method`        |
| `db.operation`          | `db.operation.name`          |
| `db.sql.table`          | `db.collection.name`         |
| `db.name`               | `db.namespace`               |
| `db.system`             | `db.system.name`             |
| `messaging.operation`   | `messaging.operation.type`   |
| `messaging.destination` | `messaging.destination.name` |

For example, `db.operation.name=findAndModify` keeps its case, and
`messaging.operation.name=publish` alone does not imply `messaging.operation.type=send`.
An explicit RabbitMQ destination such as `orders:created` stays intact. An empty
legacy exchange does not establish a queue or a current destination value.

This is a projection reader for the supported effect fields, not a full Protobuf
validator or automatic schema migration engine. Unused scalar fields are retained
for duplicate checks without interpreting them. Composite attributes supply no
scalar selector evidence. Schema URLs are preserved as provenance; they do not
trigger downloads or arbitrary transformations. Update this profile and the
OTLP regression cases when upgrading the pinned definitions.

Rejecting conflicting observations and keeping missing evidence inconclusive are
Blackbox verification policies. OpenTelemetry does not certify capture completeness,
persisted state, or whether a behavioral assertion should pass.

## Validate the package

From the repository root after a frozen dependency installation:

```sh
pnpm --filter @suites/blackbox-effects build
pnpm --filter @suites/blackbox-effects test
pnpm test:effects:consumer
```

The final command packs the built candidate and installs it into a temporary
project outside the workspace with only this package as a direct dependency. It
runs plain Node assertions, checks the published declaration shape with TypeScript,
and challenges the assertions with disposable broken-package variants. It removes
the temporary project and retains evidence under `.blackbox/tmp/effects-consumer.*`.
The fixture is synthetic OTLP; this check does not establish released-registry or
live-system acceptance. See the [consumer fixture](../../e2e/fixtures/effects-consumer/README.md).
