# Telemetry analyzer

`@suites/blackbox-telemetry-analyzer-internal` is the private workspace package that
turns retained OTLP telemetry into a deterministic, versioned **EffectSet**
([#31](https://github.com/suites-dev/blackbox/issues/31), design in discussion
[#42](https://github.com/suites-dev/blackbox/discussions/42)). It is not published
as a supported npm dependency, and no Blackbox command exposes it yet.

The analyzer is pure: it takes plain data (`EffectInput`), performs no I/O, reads no
clock, locale, path or environment, and never mutates its input. Callers read the
retained collector fragments (for example with `readCollectorFragments` from
`@suites/blackbox-otel-collector-internal`) and pass their exact raw JSON text in.

```text
retained fragments (raw OTLP JSON)
          |
          v
extract rows ----> occurrences ----> classify ----> group ----> EffectSet
(one per delivered  (service, trace,  (rule table,    (identity +   (RFC 8785 bytes,
 span, sha256 of     span) identity;   fallback:       linkage +     schema v1)
 each fragment)      deliveries merged) unclassified)  suppression)
```

## Current state (normalizer 0.1.0)

This version is the skeleton that later versions build on:

- Every fragment is digested (`sha256` of its raw text as UTF-8) into `inputs`.
- Every delivered span becomes one row. Rows with the same
  `(service.name, traceId, spanId)` merge into one **occurrence** whose
  `deliveries` list every fragment that carried it. A duplicate delivery never
  inflates a count; two real spans with identical attributes stay two occurrences.
- A duplicate delivery with different content is not silently resolved: the
  earliest delivery is kept and a `conflicting-duplicate-delivery` limitation is
  recorded.
- There are no classification, exclusion or suppression rules yet. Every
  occurrence becomes an `unclassified` effect keyed by service, span kind, span
  name and instrumentation scope name, with `linkage: unlinked` and
  `suppression: none`.
- No activities, capture facts or observation policy are part of the input yet,
  so `scope.activities` and `captureStatus` are empty, `policy` is `unavailable`,
  and `completeness` is always `provisional`.

The output is serialized with RFC 8785 (JCS). The serializer accepts only null,
booleans, safe integers, well-formed strings, arrays and plain objects, sorts keys
by UTF-16 code units, and throws on anything else, so no float, locale or platform
formatting can reach the bytes. The published JSON Schema is
[`src/schema/effect-set-v1.json`](src/schema/effect-set-v1.json), also exported as
`./schema/effect-set-v1.json`.

## Provisional semantics pending #37

These are proposals for the product owner, not final semantics. Each is recorded
here and in the delivering PRs.

| Decision                                      | Proposed default                                                                                                                               | Why                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Inspection role (#42 Q1)                      | `role` = the activity `purpose`, including `inspection`                                                                                        | Already a retained fact; nothing invented                                       |
| Activation instrumentation inventory (#42 Q2) | No schema change in #31; evidence = runtime activation + an instrumentation scope observed in that service; propose `instrumentations[]` later | Keeps the collector format out of scope and avoids overclaiming                 |
| Exact HTTP status or class (#42 Q3)           | Exact code in identity (`201` ≠ `200`); claims may derive a class                                                                              | Distinguishes 201 from 409 and double submits; a class is a lossy projection    |
| Persist or derive (#42 Q4)                    | Derive on demand; do not write `effects.json`                                                                                                  | Nothing goes stale after a normalizer upgrade; rebuilds are trivially identical |
| Forbidden effects (#42 Q5)                    | Not in #31                                                                                                                                     | Belongs to #40                                                                  |
| Occurrence key                                | `(service.name, traceId, spanId)`; duplicate deliveries merged; conflicting duplicate content becomes a limitation                             | #42                                                                             |
| Setup/stimulus naming                         | #42 `linkage` + `role` replaces #31 `origin`; `unattributed` = `linkage: unlinked`                                                             | #42 is later and agreed                                                         |
| Batch sends                                   | One occurrence per span; `batch: true` in identity; message counts not multiplied                                                              | No per-message evidence                                                         |
| pg connect/pool spans                         | `db.control`, separate from `db`                                                                                                               | Keeps "one INSERT" claims clean, like `messaging.control`                       |
| Readiness probes                              | Exclude the whole unlinked trace rooted at a SERVER span on a catalog readiness path, listed in `exclusions`                                   | The readiness probe fans out to downstream health checks                        |
| Capture-status boundary key                   | 5 effect boundaries × service, annotated with policy boundary ids                                                                              | Policy boundary kinds are free strings                                          |
| Policy source                                 | Snapshot written at Capsule start; older sessions `policy: unavailable` → provisional                                                          | The observation policy is not retained with the session today                   |
| Activity-scoped EffectSets                    | Not built; one set per capsule, callers filter by linkage                                                                                      | #42 principle 6                                                                 |
| Opt-in inclusion of query text or bodies      | Not built                                                                                                                                      | Nothing asks for it yet                                                         |
| `schemaVersion`                               | Integer `1` + `kind: "effect-set"` instead of #42's `"1.0"`                                                                                    | Matches every other retained artifact and strict decoders                       |
| Missing `service.name`                        | `unknown_service`, the OpenTelemetry resource default                                                                                          | An occurrence key needs a service; the default is the SDK's own spelling        |
| Golden storage                                | Canonical bytes stored in a fixed 2-space rendering; tests assert both the canonical bytes and the rendering                                   | A single-line canonical file cannot be reviewed line by line                    |

## Golden fixtures

[`test-fixtures/`](test-fixtures/README.md) holds one real capture from the bundled
subscription system and small hand-written cases. Each case has an `input.json` and
an `expected.effectset.json`; [`src/testing/golden.test.ts`](src/testing/golden.test.ts)
normalizes every case twice from a deep-frozen input, compares the bytes with the
golden, validates the result against the schema, and checks every occurrence against
an independent walk of the input spans.

Expected files are regenerated only on explicit request, and every regenerated line
is reviewed:

```sh
pnpm build
node packages/telemetry-analyzer/scripts/capture-fixture.mjs expected --case packages/telemetry-analyzer/test-fixtures/<case>
```

Never regenerate a golden to make a failing test pass.

## Maintainer map

| Area                       | Start here                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| Exported API               | [`src/index.ts`](src/index.ts)                                   |
| Orchestration and grouping | [`src/normalize.ts`](src/normalize.ts)                           |
| Input and output model     | [`src/model/`](src/model/)                                       |
| Canonical JSON and digests | [`src/canonical/`](src/canonical/)                               |
| OTLP flattening and values | [`src/extract/otlp-rows.ts`](src/extract/otlp-rows.ts)           |
| Occurrence identity        | [`src/extract/occurrences.ts`](src/extract/occurrences.ts)       |
| Rules (data) and digest    | [`src/rules/ruleset.ts`](src/rules/ruleset.ts)                   |
| Schema                     | [`src/schema/effect-set-v1.json`](src/schema/effect-set-v1.json) |
| Fixture capture            | [`scripts/capture-fixture.mjs`](scripts/capture-fixture.mjs)     |

Any change to the rules or to the output bytes must bump `EFFECT_NORMALIZER_VERSION`
and come with reviewed golden diffs.

## Validate changes

```sh
pnpm --filter @suites/blackbox-telemetry-analyzer-internal build
pnpm --filter @suites/blackbox-telemetry-analyzer-internal test
pnpm lint
pnpm typecheck
```
