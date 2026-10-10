# Investigate with a Capsule, confirm with Playwright

A Capsule is the coding agent's **laboratory**. Before writing the final system test, the agent can
rehearse a reviewed scenario, check whether the selected services are sufficient, and find out which
actions and observations really work. After a failed Playwright test, it can return to a Capsule to
investigate why.

A Capsule is a bounded, isolated environment for running commands, inspecting results, and retaining
evidence. **Playwright** preserves the accepted behavior as repeatable system tests. They use the
same underlying Blackbox setup but are **different executions**, not one shared live container.
[See the full developer workflow](from-spec-to-verification.md).

<p align="center">
  <img width="790" src="../assets/readme/capsule-to-feature.svg" alt="The agent investigates a system in a Capsule, proposes a candidate expectation, obtains review, and preserves the accepted behavior in Playwright." />
</p>

## Make the question smaller

Suppose a valid-cache request returns the right product but unexpectedly queries PostgreSQL. Don't
start by inspecting every service and every trace. Ask a narrow question:

> With this product already cached, does retrieving it cause the application to read PostgreSQL?

Select the **smallest real system that can answer it**:

- Keep the product service, Redis, PostgreSQL, and the observations needed to detect the read.
- Omit unrelated services only if their removal doesn't change the behavior or hide evidence.
- Record any external or replaced dependency. A test double changes what the result can establish.

Run the real participants whose behavior the rule constrains. A mocked repository cannot establish
whether the running application read PostgreSQL. Enter through the product API and observe its
resource interactions; do not replace the behavior being investigated with a simulation.

This is how we apply the idea of making
[hard-to-verify problems more testable](https://www.kipiiler.me/blog/verification-systems-llms-ai-agents).
Smaller is helpful **only when the selected boundary still preserves the relevant behavior**. A
dependency diagram by itself cannot prove two systems behave equivalently.

<p align="center">
  <img width="790" src="../assets/readme/system-boundary.svg" alt="The configured system selects the services and dependencies, action and inspection drivers, and supported runtime instrumentation needed for the behavior." />
</p>

## Run an experiment

In a configured checkout with the Capsule CLI selected, the current command families are:

```sh
blackbox capsule up <system-id> --json
blackbox capsule run --session <session-id> -- <command...>
blackbox capsule show <session-id>
blackbox capsule report <session-id>
blackbox capsule down <session-id>
```

Replace the placeholders with the **actual catalog system, recorded session ID, and an approved
command**. Capture the `sessionId` from `up --json`; don't pick the newest session by guesswork.
`capsule run` can use a configured driver to perform an HTTP stimulus or inspect state.

For individual activities, use the ID returned by the run. The detailed CLI and identity rules live
in the
[Capsule experiment reference](../../packages/capsule/skills/capsule/references/capsule-experiments.md).

A useful experiment records:

| What                                      | Why it matters                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Known starting state                      | A previous attempt's data cannot be assumed                                   |
| Stimulus and activity ID                  | Identifies the action being investigated                                      |
| Response, state, and runtime observations | Shows _what_ happened, not just whether a command exited successfully         |
| Completion and observation limits         | Distinguishes a missing operation from an operation the observer couldn't see |
| Cleanup result                            | Shows whether Blackbox released owned resources                               |

Stopping the Capsule releases its resources but preserves the retained record and report.

## What a Capsule does not execute

A Capsule can start the selected system and perform the proposed Given/When/Then actions through
supported commands and drivers. It **does not currently run a Gherkin `.feature` file as a test
suite**. The agent interprets the reviewed scenario into controlled experiments, records actual
activity IDs, and inspects the resulting HTML report.

The experiment helps the agent design a dependable test, but the **final pass/fail assertion belongs
in Playwright**. See the two authoring paths in
[From spec to verification](from-spec-to-verification.md).

## From an observation to an accepted check

A surprising Redis or SQL observation can reveal a bug—or an incorrect assumption about the
requirement. The agent should compare it with the **accepted specification** before turning it into
a permanent test.

For the cache-hit example, the specification already prohibits PostgreSQL reads. The agent can
repair the implementation and run the unchanged [Playwright scenario](verify-a-specification.md).

<p align="center">
  <img width="790" src="../assets/guides/product-cache-repair.svg" alt="The agent repairs a cache-bypass bug and reruns the same behavior check in a new isolated attempt." />
</p>

If an experiment discovers a genuinely new requirement, ask for approval first. **Observed behavior
is not automatically expected behavior.**

## Keep verification cheap enough to repeat

An agent can implement several alternatives quickly. A verification environment that takes hours to
rebuild for every attempt defeats the benefit. Reuse the reviewed expectation, select the relevant
system boundary, inspect a focused result, and rerun after a repair.

That's our application of
[the asymmetry of verification](https://www.jasonwei.net/blog/asymmetry-of-verification-and-verifiers-law):
investing in a reliable check can make evaluating the next implementation cheaper. **Blackbox
doesn't promise that every distributed-system property is quick or completely observable.**

[First business verification](verify-a-specification.md) ·
[Repair from evidence](repair-from-evidence.md) ·
[Why verification matters now](../concepts/why-verification-now.md)
