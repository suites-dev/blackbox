# Read effects and manage accepted baselines

This is design guidance for planned assurance. The current alpha exposes raw observations, command results, and a Playwright effects-contract matcher boundary. It has no normalized-effect projector or baseline-update backend, so the matcher cannot produce a supported verdict yet. Use this reference to plan evidence requirements, not to invoke unavailable projection APIs.

## Know what an effect can establish

An effect is a supported observation of an operation at a boundary. Depending on the instrumentation, it may describe a request, a database statement, a cache call, or a message operation. It is not automatically a business transaction, committed state, or completed workflow.

Match any statement to the source that can support it:

| Requested fact                            | Suitable evidence                                                 |
| ----------------------------------------- | ----------------------------------------------------------------- |
| The caller returned HTTP 201              | Native response assertion                                         |
| The checkout client sent an order request | Execution-bound HTTP witness from that client                     |
| The database client issued an INSERT      | Execution-bound database client witness                           |
| The intended order values were stored     | Application state or another source that establishes those values |
| A queue consumer completed the job        | Execution-bound completion signal or terminal state               |

Preserve the effect representation emitted by the installed producer. Record its execution, participant, service, boundary, operation, target, status, origin, multiplicity, and any producer-supplied ordering witness. A logical HTTP path may not identify a destination host. Null, absent, unavailable, and empty are different. Do not normalize them into one convenient value.

Effects include reads as well as writes. Setup and fixture-control operations can contaminate an assertion if the test does not separate them. Keep origin and activity binding from the producer; do not relabel an operation because it makes the test easier to explain.

## Make expectations precise

Prefer targeted assertions for the behavior the user cares about. A broad effects comparison can show drift, but its counts may be boundary-wide and may include unrelated traffic. State the unit being counted: normalized effect rows, producer-preserved occurrences, spans, or business actions. Client and server representations of one request are not automatically two business operations; repeated rows are not automatically duplicates.

A positive witness can establish that one supported operation occurred. An empty query or projection does not establish absence unless the relevant boundary, scope, capture and observation window are sufficient. A qualified counterexample may refute a count bound even when another boundary is incomplete. Keep that interpretation separate from the evaluator's recorded result.

Use the public matcher or query surface available in the installed version. Do not assume old method names, nested fields, counts, order behavior, or arbitrary effect filtering from a historical source. Never turn a capture exception into an empty effect list.

## Treat a baseline as expected behavior

A baseline is an accepted comparison reference, not a record that observed behavior is correct. A candidate or first run is descriptive. Review relevant requirements and targeted assertions before deciding whether a behavior change is intentional.

Exact-run baseline acceptance is planned and has no current CLI command; its final command design belongs to the CLI roadmap. Do not invoke historical baseline-update examples or use a Playwright snapshot-update flag or an agent-authored file replacement to impersonate implemented acceptance.

A baseline update changes acceptance material. Do it only when the current task authorizes the specific change. Afterward, inspect the actual changed files and run a fresh test against the new reference when that verification is requested. An update command is not a verification run, and it does not rewrite the result of the source run.

Keep narrow assertions alongside broad comparison where both serve a purpose. A baseline refresh must not delete an independent invariant or hide a missing observation boundary. If the new candidate contradicts the accepted requirement, report the conflict as a behavior or product decision.

Return the exact run ID, baseline target, accepted requirement, relevant difference, capture limits, changed files if updated, and fresh-run status. If you cannot identify the source run or baseline target, stop at review and state what is missing.
