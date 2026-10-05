# Suites Blackbox

**Executable specs for agentic software engineering.**

Blackbox is a **verification framework for coding agents**. It helps your agent check that the running software does what the spec says, using system tests and evidence from the real system.

Your agent sets it up, investigates behavior in a Capsule, and records repeatable checks with native Playwright. You review the expected behavior and follow the results in the terminal or HTML report.

**From spec → running system → evidence.**

[Start with your agent](#start-with-your-agent) · [See the spec-to-test workflow](#from-sdd-to-a-running-system)

> **Preview:** The executable-spec workflow is being connected incrementally. Feature compilation is a private preview; the public Gherkin CLI and dedicated SDD handoff skill are not available yet. The examples below explain the workflow without implying those commands have shipped.

## From SDD to a running system

Already working from a Markdown specification, or using a spec-driven development (SDD) workflow such as Spec Kit? Keep that workflow.

**The spec describes what to build. Blackbox checks whether the running system behaves that way.**

The handoff starts with your requirements, not with whatever the implementation happens to do. Your agent turns those requirements into concrete scenarios for review. The approved scenarios become executable checks.

### 1. Start with the specification

`spec.md` describes the intended behavior:

```markdown
# Subscription creation

## REQ-101: Activate an eligible customer

Alice is an eligible customer with no existing subscription.
When she subscribes with a valid payment method:

- The request returns HTTP 201.
- Exactly one subscription is retained for Alice.
- That subscription is active.
```

This is the requirement. It is not yet a test, and a successful implementation claim from the agent is not evidence that it holds.

### 2. Make the behavior executable

The agent drafts a Feature using Blackbox's supported step vocabulary. You review the expected behavior; the compiler supplies the executable steps rather than asking the implementation agent to invent what each assertion means.

This preview example uses the subscription fixture's state endpoint. The selected Sandbox seeds Alice; the agent configures the catalog and the named `fixture-control` credential. The endpoint belongs to the application fixture, not to an automatic Blackbox state reader.

```gherkin
@system:subscription-system @sandbox:default
@requirement:REQ-101
Feature: Subscription creation

  Scenario: an eligible customer receives an active subscription
    Given the state at "/fixture/state" as "fixture-control" has 0 items at "/subscriptions"
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId": "alice", "paymentMethodId": "pm_alice_primary"}
      """
    Then the response status is 201
    And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
    And the state at "/fixture/state" as "fixture-control" has "/subscriptions/0/userId" equal to:
      """json
      "alice"
      """
    And the state at "/fixture/state" as "fixture-control" has "/subscriptions/0/status" equal to:
      """json
      "active"
      """
```

The Feature is the readable specification. The preview compiler turns its scenarios into native Playwright tests and records their source locations and requirement IDs. Generated tests are build output, not another specification to edit independently.

### 3. Run against an isolated system

Blackbox's Playwright integration selects a system and a Sandbox configuration. Every test attempt, including a retry, receives a fresh Sandbox.

The following is a directly authored equivalent of the scenario above, not the compiler's literal output. Both examples check the response **and** the resulting state. Native Playwright remains a first-class path when code is the better way to express a check.

```ts
import { expect, test } from '@suites/blackbox-playwright';

const fixtureToken = process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL;
if (!fixtureToken) {
  throw new Error('BLACKBOX_CREDENTIAL_FIXTURE_CONTROL is required');
}

test.system('subscription-system', (system) => {
  system.sandbox(
    'default',
    { environment: { FIXTURE_CONTROL_TOKEN: fixtureToken } },
    (suite) => {
      suite.test(
        'an eligible customer receives an active subscription',
        { annotation: { type: 'requirement', description: 'REQ-101' } },
        async ({ request, sandbox }) => {
          const url = (path: string) => new URL(path, sandbox.entrypoint.url).href;
          const readState = async () => {
            const response = await request.get(url('/fixture/state'), {
              headers: { authorization: `Bearer ${fixtureToken}` },
            });
            expect(response.status()).toBe(200);
            return response.json();
          };

          await test.step('Given Alice has no subscription', async () => {
            expect((await readState()).subscriptions).toHaveLength(0);
          });

          const response = await test.step('When Alice subscribes', () =>
            request.post(url('/subscriptions'), {
              data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
            }),
          );

          await test.step('Then one active subscription is retained for Alice', async () => {
            expect(response.status()).toBe(201);
            const { subscriptions } = await readState();
            expect(subscriptions).toHaveLength(1);
            expect(subscriptions[0]).toMatchObject({ userId: 'alice', status: 'active' });
          });
        },
      );
    },
  );
});
```

The example checks state after the response because this fixture waits for its subscription write before responding. An asynchronous workflow needs its own completion check before final-state or absence assertions.

```text
Markdown spec → approved Feature → compiled Playwright test
                                          ↓
                                  fresh isolated system
                                          ↓
                              responses + state + observations
                                          ↓
                                  checks and report
```

This is how a specification becomes executable: its expectations are checked against a real execution. It does not mean that every sentence in an arbitrary product document has been translated or verified.

## Start with your agent

Blackbox is built for teams working with coding agents. Setup and operation belong to the agent; you own the intent and approve the expected behavior.

The intended onboarding is one task, not a tour of the package architecture. Give your coding agent:

> Set up Suites Blackbox for this repository. Inspect the project and its existing specifications. Install compatible Blackbox packages and the skills needed for this agent, then use Discovery to identify the smallest useful system boundary. Configure the catalog, supported instrumentation, and any required drivers. Start the system, run a focused check, and show me the report. Draft scenarios from the requirements for review; do not change the requirements to match the implementation. Tell me which preview steps are unavailable.

This is the agent's setup task, not a claim that a single automatic setup command has shipped. The agent checks installed capabilities and requests any permissions or secrets it needs rather than guessing.

A dedicated SDD handoff skill is planned: take the existing spec, draft supported scenarios, and connect them to verification. `speckit.verify` is a possible name, **not an available command or an official Spec Kit integration**.

## The same system test. More evidence.

**Verification means checking expected behavior against evidence.** System tests are one way to produce that evidence: establish a starting state, act on the system, and check the result.

Keep ordinary Playwright assertions. Blackbox adds an isolated environment and supported runtime observations around the execution; it does not replace response or state checks.

| Evidence | The question it answers |
| --- | --- |
| Response or command result | What came back? |
| An explicit state check | What was actually saved or changed? |
| Runtime observations | Which supported service, database, cache, or messaging operations were observed? |

An HTTP 201 does not establish that a row was saved. A database call can be observed even if its transaction rolls back. A message send does not establish consumer completion. Each check needs evidence that can answer its particular question.

Effects are a structured way to describe supported runtime observations. OpenTelemetry supplies observations; effects are not OpenTelemetry itself, and neither is a substitute for all the evidence a test needs. You do not need to learn either format to understand the workflow.

**Not observed is not the same as did not happen.** Missing telemetry or an unlinked asynchronous operation must remain a visible limitation, not a reason to claim success.

## Investigate in a Capsule. Keep what matters as a test.

A **Capsule** is a controlled copy of the selected system that your agent can use for experiments. It can prepare data, send requests, inspect state and runtime observations, try a repair, and repeat the investigation.

The agent does not need to turn every hypothesis into a permanent test. Use a Capsule to understand a problem; record the relevant checks once the expected behavior is clear. When the spec and test already exist, go straight to focused verification.

```text
Question → Capsule experiment → inspect evidence → repair and rerun
                                      ↓
                         review against the intended behavior
                                      ↓
                         record a repeatable system test
                                      ↓
                             fresh run locally or in CI
```

**What happened is not automatically what should happen.** An agent must not preserve a bug by copying its behavior into the specification. Approved expectations come from the requirement, not from the execution being judged.

## Run only what you need

**Run the smallest real system that can answer the question.** A payment rule may need only the payment subsystem. A checkout-to-order claim needs the relevant services and dependencies. Do not remove a participant whose behavior the check depends on.

A smaller boundary generally means less startup work, lower memory use, fewer competing actions, and less evidence to interpret. Its result applies to that boundary, not to services excluded from the run.

During development, ask the agent to select the relevant tests and use Capsules for experiments. Use CI for broader verification. Focused runs are useful, but they are not claims that the entire suite passed.

Each Playwright attempt has its own Sandbox. Isolation permits concurrent tests, but CPU, memory, Docker capacity, and any shared external dependencies still limit concurrency. Set worker counts for the available machine rather than starting every environment at once. A retry produces a new attempt and new evidence; it does not erase the earlier failure.

## Keep the specification and the checks honest

The implementation should not pass by silently moving the target. Changes to expected behavior need review. Changes to retries, timeouts, selected tests, or projects also change what a green run means.

The preview guardrails address different parts of this problem: strict verdicts distinguish a clean pass from skipped or flaky execution; runner-policy checks detect changes from an approved execution baseline; the repository's spec/code separation check requires specification and implementation changes to be reviewed separately.

These are not a universal semantic-drift detector. Assertions check the behaviors they express. Policy checks detect changes to how those tests run. Traceability connects scenarios to requirements; it does not prove that the requirements are complete. The consumer CLI and CI setup for this workflow are still being connected.

## Follow the execution in the report

Playwright keeps its native terminal and HTML reports. Blackbox contributes Sandbox lifecycle information, attempt identity, diagnostics, and supported evidence attachments. Capsule investigations have their own HTML and JSON reports, with retained records available after the environment stops.

The agent reads structured results; you can follow the same investigation in HTML. A report should show what ran, what was checked, what was observed, and what remains unknown. A checkmark belongs to a particular check, not to a claim that the whole system is correct.

## Underneath the workflow

<details>
<summary>How the agent connects Blackbox to your project</summary>

**Discovery** helps the agent understand the repository and select a useful system boundary. **The catalog**, in `blackbox.config.yaml`, records the systems and subsystems Blackbox can operate. Compose describes how the services run; the catalog describes how Blackbox works with them.

**Drivers** adapt commands to the selected system's endpoints or containers. **Instrumentation** observes supported runtime activity. The implemented instrumentation provider and project-driver authoring runtime currently support Node; the shared contracts are runtime-neutral. Arbitrary internal function calls are not automatically observed.

**Skills** teach the agent these procedures. **The CLI** gives it a common interface. You should not need to learn the package graph to use the framework.

</details>

Blackbox checks the behavior of the running system. Use a unit test to check an isolated calculation. Use Blackbox when the question is whether that calculation results in the correct charge, saved state, or downstream behavior. The distinction is the behavior being checked, not which source file changed.

---

**Alpha scope:** Native Playwright and Capsule workflows are available in the source preview. The [Gherkin compiler and step library](https://github.com/suites-dev/blackbox/pull/131), [runner guardrails](https://github.com/suites-dev/blackbox/pull/155), and [spec/code separation](https://github.com/suites-dev/blackbox/pull/133) are separate deliveries. The Feature example uses the preview response/state vocabulary, not arbitrary natural-language steps. The dedicated SDD skill and complete public spec-to-CI onboarding remain planned. This README does not imply npm publication or that all preview pieces are connected in this branch.
