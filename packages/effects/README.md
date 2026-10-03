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
