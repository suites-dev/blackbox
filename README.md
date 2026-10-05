# Suites Blackbox

**Executable specs for agentic software engineering.**

Blackbox is a system testing framework built for coding agents. It turns accepted behavior into executable specifications that run against real applications in isolated environments and produce evidence about what actually happened.

Your coding agent operates Blackbox through its CLI and skills. It can discover the system, reduce it to the smallest useful boundary, investigate behavior in a Capsule, and turn accepted behavior into repeatable system tests that CI can verify.

```text
Accepted behavior
       ↓
  Coding agent
       ↓
    Blackbox
       ↓
  Fresh Sandbox
       ↓
   Real system
       ↓
    Evidence
       ↓
  Verification
```

## From specification to running software

Blackbox keeps the specification close to the system that must satisfy it.

Human-readable Feature files can describe accepted behavior:

```gherkin
Feature: Subscription creation

  Scenario: an eligible user subscribes
    Given Alice has no active subscription
    When Alice subscribes with a valid payment method
    Then the response status is 201
    And Alice has one active subscription
```

Blackbox turns those scenarios into native Playwright system tests. Each physical test attempt runs against its own isolated Sandbox, so the specification is checked against a real running system rather than a mock of its internals.

Native Playwright tests remain a first-class path when code is the better way to express the behavior.

## Explore first. Verify what you accept.

A specification should not be created by blindly recording whatever the software currently does.

Use a **Capsule** to investigate. A coding agent can start the relevant system or subsystem, establish state, perform actions, inspect what happened, repair the implementation, and rerun the experiment.

Once the expected behavior is accepted, record it as an executable specification and verify it again from fresh evidence.

```text
Explore in a Capsule
        ↓
inspect evidence
        ↓
accept expected behavior
        ↓
record executable spec
        ↓
run in a fresh Sandbox
        ↓
verify in CI
```

## Verification is about evidence

A passing response answers only one question.

A Blackbox system test can collect multiple kinds of evidence from the same execution:

- **response evidence** — what the caller received;
- **state evidence** — what authoritative system state was left behind;
- **runtime evidence** — supported observations of how the running system behaved at its boundaries.

Different claims require different evidence. Blackbox keeps the execution isolated and the evidence tied to the test attempt so an agent can reason about what the run actually established.

## Built for agents

Blackbox is designed to be set up and operated by coding agents.

The framework exposes a CLI and installable agent skills for discovering a repository, configuring its runnable system boundaries, operating Capsules, and authoring system tests. The goal is not to make you learn Blackbox's package graph before you can use it.

You describe the behavior you care about. Your agent does the machinery.

## Run the smallest system that can answer the question

Blackbox favors reduced systems under test.

A payment rule should not require starting the entire product when the payment subsystem is enough. A cross-service subscription flow should include the participants required to establish that behavior.

Smaller boundaries start faster, consume less memory, produce less noise, and make evidence easier to interpret.

During development, run the smallest relevant tests. Let CI execute the broader verification suite with controlled concurrency.

---

> **Alpha:** Blackbox is under active development. The executable-spec, Playwright, Capsule, evidence, and agent workflows are evolving toward the first public alpha.
