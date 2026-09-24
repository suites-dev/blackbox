# Capsule OTLP collector

This package starts a collector dedicated to one explicit Capsule session and execution. It receives OTLP traces over HTTP, durably retains each accepted request as an immutable fragment, and reads the retained session or an exact trace without a catalog lookup.

```ts
import { startCollector } from '@suites/blackbox-otel-collector-internal';

const collector = await startCollector({
  kind: 'start-collector',
  sessionId: 'session-42',
  executionId: 'execution-7',
  storageDirectory: '/absolute/path/to/retained-telemetry',
  endpoint: {
    kind: 'http',
    host: '127.0.0.1',
    port: 4318,
    tracesPath: '/v1/traces',
    activationPath: '/v1/activation',
    readinessPath: '/ready',
    readPath: '/v1/blackbox',
  },
  authorization: { kind: 'bearer-token', token: '<session-secret>' },
  limits: { maxRequestBytes: 67_108_864, shutdownTimeoutMs: 5_000 },
});
```

Send `POST application/json` requests to `collector.endpoint.tracesUrl` with the configured bearer token. The receiver accepts identity and gzip content encodings. A successful response is the OTLP JSON `ExportTraceServiceResponse` empty object. Binary protobuf, gRPC, metrics, logs, and profiles are outside this initial transport scope and receive a factual HTTP error instead of a false success.

`GET <readinessPath>` is an unauthenticated, data-free health probe. The authenticated read API returns live factual status, exact-session inventory, an exact trace, or spans carrying an exact `blackbox.activity.id`. The exported read functions provide the same retained reads after the server stops.

Each successful ingestion is acknowledged only after its raw decompressed JSON text is stored in a fragment and the lifecycle record is updated. Derived trace reads never replace those raw fragments. Retained data survives graceful shutdown and restart. If a prior lifecycle lacks a graceful close record, the next start records it as interrupted.

Receiver readiness means only that its socket and durable store are ready. An authenticated activation records the exact runtime and service identity; telemetry status becomes `received` after the first durable request. Graceful close drains HTTP work within the configured bound, but it does not claim that every application span arrived. The collector preserves links but does not inject propagation headers, infer causality, or infer capture completeness.

The transport follows the [OTLP/HTTP specification](https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md), including the `/v1/traces` convention, JSON protobuf mapping, JSON response media type, gzip support, and bounded request parsing. OTLP JSON trace and span IDs use their specified hexadecimal wire representation.

The runnable entrypoint also requires `BLACKBOX_OTEL_ACTIVATION_PATH`, `BLACKBOX_OTEL_READINESS_PATH`, and `BLACKBOX_OTEL_AUTH_TOKEN`. The production Dockerfile builds the local image `blackbox-otel-collector:dev` from the package directory after `pnpm build`. It prints one readiness JSON line, then drains and records shutdown on `SIGINT` or `SIGTERM`.
