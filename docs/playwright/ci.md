# CI verification

Run focused tests and Capsule experiments during development. Use CI for the broader accepted verification scope with an explicit resource budget.

The planned Blackbox Action should wrap the same CLI used locally. It should not introduce a second verdict implementation or silently update the specification. Until that Action exists, use project-owned shell steps.

## Native Playwright lane

After the project has installed compatible packages, prepared instrumentation/drivers, and configured its catalog:

```sh
blackbox catalog validate
npx playwright test --config playwright.config.ts
```

Choose workers in the committed config based on available CPU, memory, and dependency capacity. A fresh Sandbox per attempt is not permission to start every environment simultaneously.

Retain the HTML report and test-results artifacts on failure as well as success. Keep cleanup outcomes visible. Use CI secrets only for approved resources; untrusted pull-request code must not receive production credentials.

## Incoming Feature verification lane

PRs #131, #155, and #165 supply the guarded pipeline. They are separate incoming deliveries in this documentation snapshot.

```sh
blackbox feature check --config blackbox.feature.yaml
blackbox feature compile --config blackbox.feature.yaml
npx playwright test --config playwright.features.config.ts
blackbox feature verify --config blackbox.feature.yaml
```

`feature check` audits project restrictions. `compile` validates and emits the accepted scenarios. Playwright executes. `verify` checks the finished run, scenario identity/requirements, runner policy, and consistency with compile inputs. It computes no semantic requirement coverage.

Use the incoming configuration helper:

```ts
import { defineGherkinConfig } from '@suites/blackbox-gherkin/config';

export default defineGherkinConfig({
  gherkinConfigFile: new URL('./blackbox.feature.yaml', import.meta.url),
  workers: 1,
  timeout: 180_000,
});
```

The incoming project file adds:

```yaml
runManifest: test-results/blackbox-run.json
policy:
  baseline: blackbox.policy.yaml
  outputFile: test-results/blackbox-policy.yaml
```

The helper owns strict verdicts, required reporters/manifests, generated-test selection, and related protected options. It rejects conflicting caller overrides and checks that Feature barrier deadlines fit inside test timeouts.

## Preserve both process and verification failure

Run verification even when a test fails to obtain its findings, but never erase the original exit status. After successful compile/preflight, a shell step can use:

```sh
set +e
npx playwright test --config playwright.features.config.ts
tests_status=$?
blackbox feature verify --config blackbox.feature.yaml
verify_status=$?
set -e
[ "$tests_status" -eq 0 ] && [ "$verify_status" -eq 0 ]
```

Configure artifact upload as an always-run step. Do not append `|| true` to the final result.

## Verification guardrails

The runner-policy baseline describes execution conditions, not accepted application behavior. Generate effective settings with the appropriate config, review them, and commit the intended baseline. Do not overwrite it automatically on every CI run.

The incoming `feature check-change --base <ref>` checks separation of spec and code changes. The chosen base must be the actual review base available in CI, not a guessed branch name. Deliberate changes to expected behavior, deadlines, or policy require review.

A filtered or sharded run is not a complete required-scenario result unless the verifier explicitly supports and validates that composition. Do not combine unrelated manifests or treat `--list` as execution.

Next: [Drift](../specifications/drift.md) · [Feature CLI](../reference/cli/feature.md).

## Source contract

[Incoming verification configuration](https://github.com/suites-dev/blackbox/blob/88a73744311e0a70d3ac5451c03a2f2e3ba436c6/packages/gherkin/README.md). [Strict reporter](https://github.com/suites-dev/blackbox/pull/155).

---

[Documentation](../README.md)
