# Instrumentation installation

```sh
blackbox inst install --runtime node
```

Select the Node provider and prepare its managed assets in `.blackbox/instrumentation/`. The directory contains the private dependency manifest, bootstrap, and installed pinned dependencies. Conflicting project edits are not silently replaced.

## Installation is not activation

The Catalog must select an activation for each application participant. The runtime mounts the prepared assets and extends `NODE_OPTIONS` using `node-preload` or `node-esm`. Existing options are preserved by the supported activation path.

A directory on disk or `runtime: node` label does not establish that the application loaded the observer. Check activation and supported observations during a real run.

## Scope

The Node provider exports traces only. It does not enable OpenTelemetry metrics/logs, instrument every function, or observe separate psql/redis-cli processes automatically. A command's captured output is a different evidence source.

Do not bypass dependency or activation failures to make the application appear ready with missing evidence. Investigate the exact participant and runtime configuration.

Next: [Instrumentation guide](../../systems/instrumentation.md) · [Runtime observations](../../verification/runtime-observations.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/instrumentation-runtime-node/README.md).

---

[Documentation](../../README.md)
