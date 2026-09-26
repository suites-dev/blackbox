# Telemetry contracts

`@suites/blackbox-telemetry-internal` is the private workspace package for the
execution-scope and W3C propagation records shared by Blackbox packages. It creates
one trace identity for a Capsule activity, injects that identity into supported
carriers, and checks that a recorded propagation outcome matches its expectation.

It is not published as a supported npm dependency. It also does not instrument an
application, receive OTLP, store spans, or prove that injected context was observed
downstream.

```text
Catalog propagation policy
          |
          v
Capsule activity scope -----> Driver preparation -----> command carrier
          |                         |
          |                         `-- propagation record
          |
          `-- activity root span --------+
                                         |
Instrumented participant spans ----------+---> OTLP collector
```

## Package boundary

The package owns three small contracts:

- **Execution scopes** create an active record with an execution ID, operation
  name, timestamps, and a sampled W3C `traceparent`. A scope can complete exactly
  once with a succeeded, failed, or interrupted result.
- **Carrier injection** writes `traceparent` and optional `tracestate` into a
  text map or canonical `TRACEPARENT` and `TRACESTATE` process variables. Unrelated
  carrier values are retained, while stale or contradictory trace values are
  rejected or replaced according to the carrier rules.
- **Propagation records** pair a declared expectation with an outcome. They cover
  no requested propagation, W3C propagation over HTTP headers, message metadata,
  or process environment, and explicit unsupported shared-state boundaries.

The versioned JSON Schemas in [`src/schema/`](src/schema/) describe the retained
execution-scope and propagation artifacts. [`src/index.ts`](src/index.ts) is the
only TypeScript export surface; the two schemas are also available through package
subpath exports.

## How consumers use it

| Consumer                                                                   | Responsibility                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Catalog](../catalog/src/model/catalog-types.ts)                           | Declares the propagation expectation for each project driver.                                      |
| [Driver](../driver/src/protocol/preparation-validation.ts)                 | Reports a preparation outcome and validates it against the requested expectation.                  |
| [Capsule](../capsule/src/manager/exec-request.ts)                          | Creates and completes the activity scope, retains its records, and exports the activity root span. |
| [Capsule driver execution](../capsule/src/execution/driver/propagation.ts) | Applies process-environment injection only after preparation has declared that carrier.            |
| [Node instrumentation runtime](../instrumentation-runtime-node/README.md)  | Continues an inherited `TRACEPARENT` and exports application spans.                                |
| [OTLP collector](../otel-collector/README.md)                              | Receives and durably retains exported spans; it does not inject context or infer causality.        |

Capsule gives the scope's `traceparent` to a project driver in its preparation
request. The driver describes what it prepared, and Capsule records the result. For
process-environment propagation, Capsule performs the final canonical injection
when it assembles the command environment. HTTP-header and message-metadata
injection remain the preparing driver's responsibility.

Raw host commands record `propagation-not-requested`; they do not receive invented
trace context. Shared-state drivers can record a named unsupported boundary rather
than claim a direct trace link that the carrier cannot provide.

## Injection is not observation

A `context-injected` outcome records the claim that expected W3C fields were placed
into the declared carrier during preparation or execution assembly. Driver-reported
injection still needs verification against the actual carrier. The record does not
show that the target received them, created child spans, exported those spans, or
that the collector retained every relevant effect.

Observed continuity requires separate runtime evidence: instrumentation must read
and continue the context, export telemetry, and the collector must accept and retain
it. The collector preserves received data but does not claim capture completeness.
Keep propagation records, collected spans, and higher-level effect evidence as
distinct facts.

## Maintainer map

| Area                           | Start here                                                   |
| ------------------------------ | ------------------------------------------------------------ |
| Exported API                   | [`src/index.ts`](src/index.ts)                               |
| W3C context construction       | [`src/context/w3c.ts`](src/context/w3c.ts)                   |
| Scope lifecycle                | [`src/lifecycle/scope.ts`](src/lifecycle/scope.ts)           |
| Carrier rules                  | [`src/propagation/carriers.ts`](src/propagation/carriers.ts) |
| Expectation/outcome validation | [`src/propagation/record.ts`](src/propagation/record.ts)     |
| Persisted schemas              | [`src/schema/`](src/schema/)                                 |

When a contract changes, update its TypeScript model, constructor or validator,
JSON Schema, tests, and all Capsule, driver, and catalog consumers together. Preserve
the package's dependency-light role; collector and runtime-specific behavior belongs
in their respective packages.

## Validate changes

Run the package checks from the repository root with the pinned workspace toolchain:

```sh
pnpm --filter @suites/blackbox-telemetry-internal lint
pnpm --filter @suites/blackbox-telemetry-internal build
pnpm --filter @suites/blackbox-telemetry-internal test
pnpm --filter @suites/blackbox-telemetry-internal test:coverage
pnpm exec prettier --check packages/telemetry/README.md
```

The unit suite covers scope lifecycle, W3C identifiers, carrier normalization,
propagation contradictions, and schema validation. These checks do not establish
runtime propagation or collector completeness; use the owning integration and E2E
lanes when those boundaries change.
