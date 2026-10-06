# Evidence sources

A system test can collect several kinds of evidence. They answer different questions; none is automatically a substitute for the others.

| Source | Example | What it can establish |
| --- | --- | --- |
| Response or command result | HTTP 201, JSON payload, exit status | What the caller received or the process reported |
| Explicit state read | A subscription returned by an inspection endpoint | The state exposed by that source at the time of the read |
| Runtime observation | An instrumented HTTP or database operation | The operation observed within the source's capture and correlation limits |

## Example: subscription creation

An accepted requirement says that Alice's request succeeds and stores one subscription. Check the response and inspect the authoritative subscription state. Do not use the response's echoed input as an independent state read.

If the requirement also says payment is requested, identify evidence for that boundary. A client span can establish an attempted outgoing request; it is not automatically proof of a successful charge. A queue publication is not automatically proof that the consumer fulfilled the order.

## State is explicitly measured

Blackbox does not infer all database state changes from SQL spans. An observed statement can roll back. A query against an application-owned state endpoint, a project driver, or another authoritative reader is a deliberate measurement whose own failure and timing matter.

Keep setup, stimulus, and inspection separate. An inspection endpoint that changes state is not a neutral observer and must be treated accordingly.

## Retain the context

Useful evidence includes the source revision, selected catalog entry, physical attempt or session ID, activity ID when present, initial conditions, action, observation scope, and any gaps. A file path without identity is easy to confuse with a neighboring run.

Reports are projections over retained records. Agent explanations may cite them, but must not mutate the original evidence or become new evidence merely by being saved.

## Choosing what to collect

Collect the evidence needed by the claim. Do not load every trace into the agent context by default. Start from a failed check or business identifier and follow only the relevant activities, state reads, and observations.

Next: [Runtime observations](runtime-observations.md) · [Qualifications](evidence-qualification.md) · [Reports](../capsules/reports.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/references/evidence-and-reports.md).

---

[Documentation](../README.md)
