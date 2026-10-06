# blackbox.config.yaml

This file describes how Blackbox operates a selected system. The coding agent should create it from the repository's existing runtime setup, not from a generic architecture template.

## Complete structural example

The following declares an HTTP application already defined as service `api` in the project's `compose.yaml`. It intentionally declares no runtime observation. It is a configuration example, not a standalone runnable application.

```yaml
schemaVersion: 1
catalog:
  default: app
  entries:
    app:
      kind: system
      acquisition:
        adapter: docker-compose@1
        files: [compose.yaml]
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness:
          path: /health
          timeoutMs: 60000
      participants:
        api:
          service: api
          role: entrypoint
          runtime: node
      drivers: {}
      observation:
        policyId: response-state-only
        boundaries: []
        requiredBoundaries: []
        terminalObservationWindowMs: 0
        redaction:
          requestBodies: not-captured
          headers: [authorization, cookie, set-cookie]
          dynamicIdentifiers: retained by the application state reader
activations: {}
```

Validate before execution. The Compose file must exist, contain the referenced service, and start an application serving the declared endpoint. Static schema validity does not establish those runtime properties.

## Enable supported Node observation

After the agent installs the Node bundle, an activation declaration can reference it:

```yaml
activations:
  node-cjs:
    ref: .blackbox/instrumentation/instrumentation.js
    adapter: node-preload
    version: 1
```

Add `activation: node-cjs` to the intended Node participant and configure the relevant observation boundaries. Use `node-esm` for the supported ESM activation path, not a guessed adapter name.

## Do not confuse the two project files

`blackbox.config.yaml` is the system catalog. `blackbox.feature.yaml` configures incoming Feature discovery, Sandbox profiles/credentials, generated output, and verification artifacts. A native Playwright suite can use the catalog without a Feature project file.

## Paths, secrets, and declarations

Paths are project-relative and must remain within the project after resolution. A runtime label does not install an observer. An `authoritativeFor` description declares the intended observation role; it does not prove capture quality or turn a SQL observation into committed state.

Keep credentials out of YAML values and features. Supply approved values through the runner and the supported profile/environment mechanisms. Review exported reports independently for application data.

Next: [Schema reference](../reference/config-schema.md) · [Instrumentation](instrumentation.md).

## Source contract

[Canonical schema](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/catalog/schema/blackbox-config-v1.json). [Repository example](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/e2e/blackbox.config.yaml).

---

[Documentation](../README.md)
