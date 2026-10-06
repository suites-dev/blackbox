# Configuration schema

The system catalog and the Feature project file serve different purposes. Do not merge them into one undocumented YAML shape.

| File | Responsibility |
| --- | --- |
| `blackbox.config.yaml` | Runnable systems, participants, drivers, activations, and observation policy |
| `blackbox.feature.yaml` | Feature inputs, profiles, generated output, and incoming verification records |
| `blackbox.policy.yaml` | Reviewed runner settings baseline in the guardrails preview |

## Catalog v1

The canonical JSON Schema is `packages/catalog/schema/blackbox-config-v1.json`, exported at `@suites/blackbox-catalog/schema/blackbox-config-v1.json`. Root and nested objects reject undocumented properties.

| Root field | Required | Contract |
| --- | --- | --- |
| `schemaVersion` | Yes | Exactly `1` |
| `catalog` | Yes | `default` entry ID and nonempty `entries` map |
| `activations` | Yes | Named activation map; may be empty |

Identifiers start with an alphanumeric character and then use letters, digits, `.`, `_`, or `-`. Paths are project-relative; real containment and reference validity are checked semantically.

### Catalog entry

Each entry requires `kind`, `acquisition`, `entrypoint`, `participants`, `drivers`, and `observation`.

| Field | Contract |
| --- | --- |
| `kind` | `system` or `subsystem` |
| `acquisition.adapter` | `docker-compose@1` |
| `acquisition.files` | Nonempty ordered relative Compose file list |
| `entrypoint.participant` | Existing participant ID |
| `entrypoint.protocol` | `http` or `https` |
| `entrypoint.containerPort` | Integer 1–65535 |
| `entrypoint.readiness.path` | Nonempty readiness route |
| `entrypoint.readiness.timeoutMs` | Positive integer |
| `participants` | Nonempty map |
| `drivers` | Named driver map; may be empty |
| `observation` | Required policy object described below |

Each participant requires `service`, `role`, and `runtime`. Roles are `entrypoint`, `application`, or `dependency`. Optional `activation` references the root activation map. A runtime label is descriptive; it does not install instrumentation.

### Activation

Each activation requires `ref`, `adapter`, and `version: 1`. The schema allows an adapter string; the runtime must actually provide that adapter. The audited Node provider implements `node-preload` and `node-esm`.

### Driver

Each driver requires `kind: project-driver`, `runtime: node`, a module `ref`, `target`, `execution`, and `propagation`.

The target is `{ kind: participant, participant, protocol, containerPort }`. Execution is either `{ kind: host }` or `{ kind: participant, participant }`.

Supported propagation declarations are:

```yaml
propagation:
  kind: w3c-trace-context-propagation
  carrier: http-headers
```

Carriers may be `http-headers`, `message-metadata`, or `process-environment`. For an unsupported shared-state linkage:

```yaml
propagation:
  kind: shared-state-propagation-unsupported
  resource: redis
```

Do not add a third propagation variant from an older example unless the installed schema accepts it.

### Observation policy

Required fields are `policyId`, `boundaries`, `requiredBoundaries`, `terminalObservationWindowMs`, and `redaction`. Each boundary has `id`, `kind`, and a nonempty `authoritativeFor` string list. Required boundary IDs must be unique and resolve appropriately.

The observation window is a nonnegative duration. It is not a business completion predicate. Redaction requires `requestBodies`, `headers`, and `dynamicIdentifiers`. These declarations express policy; they do not establish that arbitrary payloads are secret-free or every declared boundary was observed.

See [complete catalog example](../systems/blackbox-config.md).

## Feature project v1 — incoming preview

Paths resolve from the directory containing the Feature project file. Undocumented keys are rejected.

```yaml
schemaVersion: 1
blackboxConfigFile: blackbox.config.yaml
features:
  - features/**/*.feature
outputDir: .features-gen
sandboxes:
  default:
    environment:
      FIXTURE_CONTROL_TOKEN: { fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
    credentials:
      fixture-control: { scheme: bearer, fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
changes:
  spec: []
  neutral:
    - "**/*.md"
```

Profiles reference runner environment variable names rather than embedding credentials. Generated files name the variables, not their secret values. The output directory must be ignored rather than committed.

`changes.spec` and `changes.neutral` affect change classification. The sample Markdown-neutral pattern is not appropriate when Markdown contains your protected accepted requirements; classify those files explicitly for your workflow.

Incoming #165 adds:

```yaml
runManifest: test-results/blackbox-run.json
policy:
  baseline: blackbox.policy.yaml
  outputFile: test-results/blackbox-policy.yaml
```

Use `defineGherkinConfig` from `@suites/blackbox-gherkin/config` for its guarded Playwright config. Native tests use `defineConfig` from the Playwright adapter instead.

## Runner policy

The audited guardrail output uses `schemaVersion: 3` and a `policy` object. It records settings that can change the result, omitting defaults. Generate and review the actual effective baseline rather than copying a made-up full schema from this page. A listed configuration does not prove any scenario ran.

Next: [Drift](../specifications/drift.md) · [CI](../playwright/ci.md).

## Source contract

[Catalog schema](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/catalog/schema/blackbox-config-v1.json). [Feature project contract](https://github.com/suites-dev/blackbox/blob/88a73744311e0a70d3ac5451c03a2f2e3ba436c6/packages/gherkin/README.md).

---

[Documentation](../README.md)
