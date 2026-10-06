# Suites Blackbox

**Executable specs for agentic software engineering.**

Blackbox is a verification framework for coding agents. It gives your agent the tools to run system tests in isolation, collect evidence, and verify behavior against your spec.

Agents use the CLI and skills for setup and investigation. Playwright runs the tests.

[Setup](#setup) · [Specification workflow](#specification-workflow) · [Documentation](docs/README.md)

## Setup

**CLI preview:** `onboarding start`, `feature create`, and `feature suite emit` below describe the proposed interface. They are not implemented in this branch. The Playwright commands use the existing native runner.

Copy this task into your coding agent from the project directory:

```txt
Set up Blackbox for this repository using its CLI and agent skills.
Use npx @suites/blackbox-cli onboarding start when available;
otherwise follow the source-preview setup.
Discover the smallest relevant system, run a check, and open the report.
```

With the CLI installed, the proposed onboarding entry point is:

```console
$ blackbox onboarding start
```

The agent handles package installation, Discovery, catalog configuration, instrumentation, and drivers. Expected behavior remains subject to review.

[Setup guide](docs/getting-started.md) · [Agent skills](docs/agent-skills.md)

## Specification workflow

A Markdown requirement from Spec Kit or another spec-driven development (SDD) workflow can be the starting point. Blackbox provides the execution and evidence needed to check it; it does not replace the specification process. A dedicated SDD handoff skill is planned.

<!-- figure: spec-to-evidence
Future asset: docs/assets/figures/01-spec-to-evidence.svg
Alt: A Markdown requirement becomes a draft Feature through feature create.
After review, feature suite emit compiles the Feature to a Playwright suite.
The native Playwright runner executes it in isolated Sandboxes and retains evidence.
Command labels describe the proposed CLI, not a recorded successful execution.
-->
```text
requirement.md
      |
      | blackbox feature create
      v
Feature draft -- review --> feature.feature
                                  |
                                  | blackbox feature suite emit
                                  v
                            Playwright suite
                                  |
                                  | npx playwright test
                                  v
                          Sandboxes + evidence
```

### 1. Write the requirement

`requirement.md`:

```markdown
## REQ-101: Create a subscription
Given an eligible customer and no subscriptions,
POST /subscriptions returns HTTP 201 and stores one subscription.
```

Create a Feature draft from the requirement:

```console
$ blackbox feature create --spec=requirement.md
```

### 2. Review the Feature

`feature.feature` uses the supported preview step vocabulary. This example assumes the selected Sandbox seeds Alice and configures the fixture credential.

```gherkin
@system:subscription-system @sandbox:default
@requirement:REQ-101
Feature: Subscriptions
  Scenario: Alice subscribes
    Given the state at "/fixture/state" as "fixture-control" has 0 items at "/subscriptions"
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId":"alice","paymentMethodId":"pm_alice_primary"}
      """
    Then the response status is 201
    And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
```

Review the expectations against the requirement, then emit the suite:

```console
$ blackbox feature suite emit --file=feature.feature
```

### 3. Run the suite

The emitter targets Blackbox's native Playwright integration. This is a directly authored equivalent, not the compiler's literal output:

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { blackboxEnvironment, readFixtureState } from './support.js';

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: blackboxEnvironment }, (suite) => {
    suite.test('Alice subscribes', async ({ request, sandbox }) => {
      const state = () => readFixtureState<{ subscriptions: unknown[] }>(
        request, sandbox.entrypoint.url,
      );
      expect((await state()).subscriptions).toHaveLength(0);
      const response = await request.post(
        new URL('/subscriptions', sandbox.entrypoint.url).href,
        { data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' } },
      );
      expect(response.status()).toBe(201);
      expect((await state()).subscriptions).toHaveLength(1);
    });
  });
});
```

`support.js` contains project-owned setup and state-reading helpers. `/fixture/state` is an endpoint in the example application. Generated tests are build output: edit the Feature and re-emit, rather than editing generated files.

With the emitted suite included in the Playwright configuration, run a selected scenario:

```console
$ npx playwright test --grep "Alice subscribes"
```

Run the configured suite in CI:

```console
$ npx playwright test
```

The agent configures Playwright to discover the emitted tests and enables the Blackbox, terminal, and HTML reporters. Tests can also be authored directly; Feature files are not required for native Playwright use.

[Complete example](docs/spec-to-test.md) · [SDD integration](docs/sdd.md) · [Playwright configuration](docs/playwright.md)

## Evidence

Verification compares expected behavior with evidence from an execution. Response assertions, explicit state checks, and runtime observations answer different questions.

<!-- figure: evidence-sources
Future asset: docs/assets/figures/02-evidence-sources.svg
Alt: One system-test execution provides response evidence, explicit state checks,
and supported runtime observations for checking expected behavior.
Do not depict state checks as automatic telemetry collection.
-->
```text
                    SYSTEM-TEST EXECUTION
                             |
          +------------------+------------------+
          |                  |                  |
       Response          State checks       Observations
    What came back?    What was saved?      What ran?
          |                  |                  |
          +------------------+------------------+
                             |
                  Checks against the spec
```

A database call does not establish that a row was committed. A message send does not establish consumer completion. Missing observations remain a limitation, not proof that an operation did not happen.

OpenTelemetry supplies runtime observations. Effects describe supported observations in a structured form; they do not replace response or state assertions.

[Verification model](docs/verification.md) · [Runtime evidence](docs/runtime-evidence.md)

## Capsule experiments

A Capsule runs the selected system for investigation without requiring a permanent test for every hypothesis. The agent can prepare state, execute commands, inspect evidence, and rerun after a change.

<!-- figure: capsule-to-ci
Future asset: docs/assets/figures/03-capsule-to-ci.svg
Alt: Capsule experiments support investigation and repair. Candidate checks require
review against the specification before becoming repeatable Playwright tests.
The observed result does not define the expected behavior.
-->
```text
Capsule --> Set state --> Act --> Inspect evidence
               ^                       |
               +----- Repair/repeat ---+
                                       |
                                 Candidate checks
                                       |
                              Review against the spec
                                       |
                                Playwright tests
```

Use the requirement to decide what should happen. Do not change an expectation merely to match an observed result. When a suitable test already exists, run it directly.

[Capsule workflow](docs/capsules.md) · [Recording a test](docs/spec-to-test.md)

## Isolation and concurrency

Select the smallest system that contains the behavior under test. A subsystem check does not establish that excluded services or integrations work.

<!-- figure: isolated-attempts
Future asset: docs/assets/figures/04-isolated-attempts.svg
Alt: Two Playwright workers run separate Sandboxes while a third test waits.
Every attempt, including a retry, owns a fresh Sandbox. Concurrency is resource-bound.
-->
```text
Worker 1   Test A --> [Sandbox A]
Worker 2   Test B --> [Sandbox B]
Waiting    Test C --> [fresh Sandbox when a worker is free]

More workers --> more simultaneous environments --> more CPU / memory
```

Each physical attempt, including a retry, receives a fresh Sandbox. Size the worker count for the available memory, CPU, and Docker capacity. Shared external dependencies still require coordination.

Run relevant tests during development and the broader suite in CI. Retain failed attempts even when a retry passes. Changes to test selection, timeouts, or retries change the verification scope and should be reviewed.

[System boundaries](docs/configuration.md) · [CI configuration and guardrails](docs/ci.md)

## Reports

Playwright retains its native terminal and HTML reporting. Blackbox adds Sandbox lifecycle information, attempt identity, diagnostics, and supported evidence attachments.

With HTML reporting enabled at its default output path, open the report after the run:

```console
$ npx playwright show-report
```

<!-- figure: report-views
Future asset: docs/assets/figures/05-report-views.svg
Alt: Terminal and HTML reports and structured results expose the same execution
for developer review and agent inspection. Preserve checks and limitations.
Replace or accompany this figure with real report captures, not invented verdicts.
-->
```text
                   Test execution
                   /            \
       Terminal / HTML       Structured results
       Developer review      Agent inspection
                   \            /
           Checks + observations + limitations
```

Capsules have separate HTML and JSON reports that remain available after the environment stops. Reports show retained results; they do not establish correctness beyond the checks that ran.

[Report formats](docs/reports.md) · [Runner policy and strict verdicts](docs/ci.md#verification-guardrails)

## Documentation

[Discovery and catalog](docs/configuration.md) · [Drivers](docs/drivers.md) · [Node instrumentation](docs/instrumentation.md) · [CLI and skills](docs/agent-skills.md)

Blackbox provides the means to verify running-system behavior. Unit tests remain appropriate for isolated function logic; an internal code change may still require system-level checks.

*This documentation rewrite includes proposed CLI interfaces and a private-preview Feature compiler. Documentation links reserve pages to be written separately. Figure comments identify future SVG assets; the ASCII diagrams are not captured execution results.*
