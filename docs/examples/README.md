# Subscription example

This directory contains reviewable documentation examples for one behavior: an eligible request returns 201 and leaves one active subscription for Alice.

The example targets the repository's subscription fixture. It does **not** include a standalone application, Docker images, or a credential. The agent must prepare the selected `subscription-system` Catalog boundary and fixture runtime first.

| File | Role |
| --- | --- |
| [requirement.md](requirement.md) | Accepted requirement, fixture conditions, and scope |
| [Feature](features/subscriptions.feature) | Incoming v1 closed-vocabulary scenario |
| [Native test](subscriptions.spec.ts) | Directly authored equivalent, not literal compiler output |
| [support.ts](support.ts) | Project-owned fixture state reader and credential handoff |
| [Native configuration](playwright.config.ts) | Adapter config and reporters |
| [Feature configuration](blackbox.feature.yaml) | Incoming compiler profile and input paths |
| [Guarded configuration](playwright.feature.config.ts) | Incoming #165 runtime integration |

## Prepare a project

Copy the example files to the intended project root and preserve their relative layout. Supply `blackbox.config.yaml` for the fixture and the compatible packages. Set `BLACKBOX_E2E_FIXTURE_TOKEN` through the local/CI secret mechanism; do not commit its value.

The fixture must seed Alice as eligible, start with no subscriptions, expose authenticated `/fixture/state`, and complete its write before returning the subscription response. Those are fixture contracts, not automatically provided by Blackbox. A real asynchronous application requires a different completion condition.

## Native route

```sh
npx playwright test --config playwright.config.ts
npx playwright show-report
```

The native file checks initial state, status, count, user, and active status. Its helper validates the shape it reads and does not swallow a failed HTTP or shape check.

## Feature route

With the incoming Gherkin preview and its required guardrail integration installed:

```sh
blackbox feature check --config blackbox.feature.yaml
blackbox feature compile --config blackbox.feature.yaml
npx playwright test --config playwright.feature.config.ts
blackbox feature verify --config blackbox.feature.yaml
```

Use the [CI failure-preserving procedure](../playwright/ci.md) in automation. Review a real generated runner-policy baseline before requiring it; the example does not fabricate one. Ignore `.features-gen/`, `test-results/`, and `playwright-report/` in the consumer project.

Generated tests are derived output. Never edit them to match a broken implementation or run the native equivalent alongside generated tests under a verifier that expects only compiled scenarios.

## Validation scope

These files were checked as documentation examples against the audited source contracts. They were not executed against a live subscription system in this documentation environment. The repository's E2E fixture and incoming compiler test lanes remain the runtime evidence, not this directory's existence.

---

[Documentation](../README.md)
