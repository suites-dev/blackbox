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
    readPath: '/v1/blackbox',
  },
  limits: { maxRequestBytes: 67_108_864, shutdownTimeoutMs: 5_000 },
});
```

Send `POST application/json` requests to `collector.endpoint.tracesUrl`. The receiver accepts identity and gzip content encodings. A successful response is the OTLP JSON `ExportTraceServiceResponse` empty object. Binary protobuf, gRPC, metrics, logs, and profiles are outside this initial transport scope and receive a factual HTTP error instead of a false success.

`GET <readPath>` returns live factual status, `GET <readPath>/session` reads the exact retained session with a sorted inventory of its distinct trace IDs, and `GET <readPath>/traces/<32-hex-trace-id>` returns only spans for that trace while preserving their OTLP resource, scope, events, attributes, status, and links. The exported `readCollectorSession` and `readCollectorTrace` functions provide the same retained reads after the server stops.

Each successful ingestion is acknowledged only after its raw decompressed JSON text is stored in a fragment and the lifecycle record is updated. Derived trace reads never replace those raw fragments. Retained data survives graceful shutdown and restart. If a prior lifecycle lacks a graceful close record, the next start records it as interrupted.

Receiver readiness means only that its socket and durable store are ready. Instrumentation status remains `unknown`; telemetry status becomes `received` after the first durable request. Graceful close drains HTTP work within the configured bound, but it does not claim that instrumentation was loaded or that every application span arrived. The collector preserves links but does not inject propagation headers, infer causality, or infer capture completeness.

The transport follows the [OTLP/HTTP specification](https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md), including the `/v1/traces` convention, JSON protobuf mapping, JSON response media type, gzip support, and bounded request parsing. OTLP JSON trace and span IDs use their specified hexadecimal wire representation.

The runnable `blackbox-otel-collector` entrypoint requires explicit `BLACKBOX_OTEL_SESSION_ID`, `BLACKBOX_OTEL_EXECUTION_ID`, `BLACKBOX_OTEL_STORAGE_DIRECTORY`, `BLACKBOX_OTEL_HOST`, `BLACKBOX_OTEL_PORT`, `BLACKBOX_OTEL_TRACES_PATH`, `BLACKBOX_OTEL_READ_PATH`, `BLACKBOX_OTEL_MAX_REQUEST_BYTES`, and `BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS` environment variables. It prints one readiness JSON line, then closes on `SIGINT` or `SIGTERM`.
