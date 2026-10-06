# Suites Blackbox

**Executable specs for agentic software engineering.**

Blackbox is a **verification framework for coding agents**. It gives your agent the tools to run system tests in isolation, collect evidence, and verify behavior against your spec.

**You own the intent. Your agent handles the setup, experiments, and tests.**

[Get started](#just-copy-this-prompt-and-start) · [How it works](docs/verification.md) · [Documentation](docs/README.md)

## Just copy this prompt and start

Open your coding agent in the project and paste:

```txt
Set up Suites Blackbox for this project using its CLI and agent skills.
Check whether the onboarding entry point is available:
npx @suites/blackbox-cli onboarding start

Use the available setup path and discover the smallest useful system.
Run a focused check and show me the HTML report.
Draft executable scenarios from my spec for review; don't change the
spec to match the implementation.
```

*Preview: `onboarding start` is the planned entry point, not a shipped command. Until it is available, the agent uses the existing setup path.*

[Agent setup](docs/getting-started.md) · [Skills and permissions](docs/agent-skills.md)

## From your spec to a running system

Already using Spec Kit or another **spec-driven development (SDD)** workflow? Keep it. Your spec describes what to build; Blackbox gives your agent a way to verify it.

<!-- figure: spec-to-evidence
Future asset: docs/assets/figures/01-spec-to-evidence.svg
Alt: An agent drafts scenarios from a specification for review. Approved Features
compile to native Playwright tests, which run against a real isolated system.
Keep the approval boundary explicit; do not depict prose as automatically verified.
-->
```text
   YOUR SPEC        REVIEWED FEATURE       PLAYWRIGHT SUITE
   What to build --> What to check -------> Executable checks
                                                |
                                                v
                                     +---------------------+
                                     | Fresh Sandbox       |
                                     | Real running system |
                                     +---------------------+
                                                |
                                         Evidence + report
```

**1. The spec** — a small requirement, with Alice seeded in a fresh fixture.

```markdown
## REQ-101: Create a subscription
An eligible customer's request returns HTTP 201
and leaves exactly one subscription in the system.
```

**2. The Feature** — concrete checks from the supported preview vocabulary.

```gherkin
@system:subscription-system @sandbox:default
@requirement:REQ-101
Feature: Subscriptions
  Scenario: Alice subscribes
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId":"alice","paymentMethodId":"pm_alice_primary"}
      """
    Then the response status is 201
    And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
```

**3. The Sandbox test** — the same checks expressed directly in native Playwright, not the compiler's literal output.

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { blackboxEnvironment, readFixtureState } from './support.js';

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: blackboxEnvironment }, (suite) => {
    suite.test('Alice subscribes', async ({ request, sandbox }) => {
      const response = await request.post(
        new URL('/subscriptions', sandbox.entrypoint.url).href,
        { data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' } },
      );
      expect(response.status()).toBe(201);
      const state = await readFixtureState<{ subscriptions: unknown[] }>(
        request, sandbox.entrypoint.url,
      );
      expect(state.subscriptions).toHaveLength(1);
    });
  });
});
```

`support.js` contains project-owned setup and state-reading helpers; `/fixture/state` belongs to the example application. Native tests remain a first-class path. Generated tests are build output, not another spec to edit.

[Full example](docs/spec-to-test.md) · [SDD handoff — planned](docs/sdd.md) · [Playwright guide](docs/playwright.md)

## The same system test. More evidence.

**Verification means checking expected behavior against evidence.** A response, a state check, and a runtime observation answer different questions.

<!-- figure: evidence-sources
Future asset: docs/assets/figures/02-evidence-sources.svg
Alt: One system-test execution provides response evidence, explicit state checks,
and supported runtime observations. These inform checks against expected behavior.
State reads must remain explicit, not implied to be automatic telemetry.
-->
```text
                    ONE SYSTEM-TEST EXECUTION
                               |
           +-------------------+-------------------+
           |                   |                   |
        RESPONSE          STATE CHECKS         OBSERVATIONS
     What came back?    What was saved?       What ran?
           |                   |                   |
           +-------------------+-------------------+
                               |
                  Check the expected behavior
```

A database call is not proof of a committed row. A message send is not proof of consumer completion. **Not observed does not mean it did not happen.**

Effects describe supported runtime observations; they do not replace response or state assertions.

[Verification and evidence](docs/verification.md) · [Runtime observations and effects](docs/runtime-evidence.md)

## Experiment in a Capsule. Keep what matters as a test.

A **Capsule** gives your agent a controlled running system for investigation. Try a hypothesis, inspect the evidence, repair, and rerun. Record useful checks once the expected behavior is clear.

<!-- figure: capsule-to-ci
Future asset: docs/assets/figures/03-capsule-to-ci.svg
Alt: Capsule experiments support investigation and repair. Reviewed expectations
become repeatable Playwright checks. Development runs narrowly; CI runs broadly.
The spec, not the observed result, determines the expected behavior.
-->
```text
        CAPSULE                         PLAYWRIGHT
   Explore and investigate          Repeat accepted checks
             |                              |
   Act --> Inspect --> Repair      Spec --> Test --> Evidence
    ^_____________________|                 |
             |                      Focused runs locally
             +-- reviewed checks --> Broader suite in CI
```

**What happened is not automatically what should happen.** The agent must not turn a bug into an accepted specification. Already have the right test? Run it directly.

[Capsule experiments](docs/capsules.md) · [From investigation to a test](docs/spec-to-test.md)

## Run only what you need

**Choose the smallest system that can answer the question.** Keep the services the behavior depends on; leave unrelated ones out.

<!-- figure: isolated-attempts
Future asset: docs/assets/figures/04-isolated-attempts.svg
Alt: Each Playwright attempt owns a separate Sandbox. Two available workers run
two attempts while another waits. Isolation enables concurrency, not unlimited capacity.
-->
```text
             TWO WORKERS / THREE TESTS

  Worker 1   Test A --> [Sandbox A]
  Worker 2   Test B --> [Sandbox B]
  Waiting    Test C --> [fresh Sandbox when a worker is free]

  More workers = more simultaneous environments = more resources
```

Every physical attempt, including a retry, gets a fresh Sandbox. Isolation permits parallel work, not unlimited memory or CPU. Shared external dependencies still need care.

Run focused tests during development; use CI for broader verification. A subset is not the whole suite, and a retry does not erase an earlier failure.

[System boundaries](docs/configuration.md) · [Concurrency and CI](docs/ci.md)

## Follow the evidence, not just a checkmark

Playwright keeps its native terminal and HTML reports. Blackbox adds lifecycle information, attempt identity, diagnostics, and supported evidence attachments. Capsule reports let you revisit an investigation after its environment stops.

<!-- figure: report-views
Future asset: docs/assets/figures/05-report-views.svg
Alt: A developer follows terminal and HTML reports while an agent reads structured
results from the same execution. Both inspect checks, observations and limitations.
Later accompany this conceptual figure with real report captures, not mock verdicts.
-->
```text
                  SAME EXECUTION
                  /            \
       TERMINAL / HTML       STRUCTURED RESULTS
       You follow the run    Your agent follows the evidence
                  \            /
            Checks + observations + limitations
```

CI should also make changes to expected behavior, test selection, retries, and timeouts visible. Runner-policy checks and spec/code separation protect different parts of that workflow; neither proves every requirement is covered.

[Reports](docs/reports.md) · [Specification and execution guardrails](docs/ci.md#verification-guardrails)

---

**Under the hood:** Your agent handles [Discovery and the catalog](docs/configuration.md), [drivers](docs/drivers.md), and [Node instrumentation](docs/instrumentation.md) through the [CLI and skills](docs/agent-skills.md). You do not need to learn the package graph.

**Scope:** Blackbox supplies the means to verify running-system behavior, not isolated function logic. Use unit tests for that; internal code changes can still warrant system-level checks.

**Preview:** Feature compilation is a private preview. The onboarding command, dedicated SDD handoff skill, and complete public spec-to-CI setup remain planned. The ASCII figures are conceptual, not captured test results. Documentation links reserve the next pages in this rewrite.
