# Investigation workflow

Use this workflow when the expected behavior is known but the cause of a failure is not, or when you need to understand an unfamiliar system before proposing checks.

## State the question

Write a bounded question: “After one subscription request, is Alice's subscription retained and is an order published?” Record the expected result and its source. Separate a product obligation from a hypothesis about how the implementation achieves it.

List the evidence the question needs. A response check, a state read, and an observation of a downstream request are not interchangeable.

## Select the boundary

Ask Discovery for the smallest runnable system that includes the relevant behavior and dependencies. Review any external systems, substitutions, credentials, and unresolved dependencies before execution. Catalog validation is static preflight, not proof that the boundary starts.

## Run the experiment

Acquire a Capsule and preserve its actual ID. Establish starting state through separate setup activities. Issue one stimulus, then use bounded inspection to check completion and collect evidence. Do not repeat a payment or order request while waiting for its consequence.

Use explicit session identities for every command. A mutable current Capsule or the newest report is not a safe selector when agents or workers run concurrently.

## Interpret and repair

Inspect the whole session when an asynchronous handoff breaks trace continuity. Preserve the gap: a separately traced consumer may be relevant without being proven a child of the stimulus.

Compare the result with the accepted expectation. If repair is authorized, change the implementation, restore known conditions, and rerun the same question. If the expectation needs clarification, stop and request it; do not manufacture an answer from the current implementation.

## Close the session

Export a report, stop the exact Capsule, and inspect cleanup. Put cleanup in a failure-safe path so a report error does not leave the environment running. Do not remove unrelated containers, networks, or retained records.

A handoff should include:

```text
Question / expected result / source
Selected system and execution identity
Setup, stimulus, and completion check
Response, state, and observation evidence
Finding and remaining uncertainty
Report location and cleanup outcome
```

This is a reporting outline, not a runtime JSON schema. Use the actual CLI response contracts for automation.

Next: [Capsule procedure](../capsules/experiments.md) · [Record a test](authoring-verification.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/SKILL.md).

---

[Documentation](../README.md)
