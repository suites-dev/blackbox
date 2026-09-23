# Read effects and manage accepted baselines

Use this reference when examining normalized runtime observations, designing effect assertions, or updating an effects baseline.

## Know what an effect can establish

An effect is a supported observation of an operation at a boundary. Depending on the instrumentation, it may describe a request, a database statement, a cache call, or a message operation. It is not automatically a business transaction, committed state, or completed workflow.

Match any statement to the source that can support it:

| Requested fact                            | Suitable evidence                                                 |
| ----------------------------------------- | ----------------------------------------------------------------- |
| The caller returned HTTP 201              | Native response assertion                                         |
| The checkout client sent an order request | Correlated HTTP effect from that client                           |
| The database client issued an INSERT      | Correlated database client effect                                 |
| The intended order values were stored     | Application state or another source that establishes those values |
| A queue consumer completed the job        | Correlated completion signal or terminal state                    |

Preserve the effect representation emitted by the installed producer. Record its execution, participant, service, boundary, operation, target, status, origin, multiplicity, and any producer-supplied ordering witness. A logical HTTP path may not identify a destination host. Null, absent, unavailable, and empty are different. Do not normalize them into one convenient value.

Effects include reads as well as writes. Setup and fixture-control operations can contaminate an assertion if the test does not separate them. Keep origin and activity binding from the producer; do not relabel an operation because it makes the test easier to explain.

## Make expectations precise

Prefer targeted assertions for the behavior the user cares about. A broad effects comparison can show drift, but its counts may be boundary-wide and may include unrelated traffic. State the unit being counted: normalized effect rows, producer-preserved occurrences, spans, or business actions. Client and server representations of one request are not automatically two business operations; repeated rows are not automatically duplicates.

A positive witness can establish that one supported operation occurred. An empty query or projection does not establish absence unless the relevant boundary, scope, capture and observation window are sufficient. A qualified counterexample may refute a count bound even when another boundary is incomplete. Keep that interpretation separate from the evaluator's recorded result.

Use the public matcher or query surface available in the installed version. Do not assume old method names, nested fields, counts, order behavior, or arbitrary effect filtering from a historical source. Never turn a capture exception into an empty effect list.

## Treat a baseline as expected behavior

A baseline is an accepted comparison reference, not a record that observed behavior is correct. A candidate or first run is descriptive. Review relevant requirements and targeted assertions before deciding whether a behavior change is intentional.

The accepted Alpha update selector is exact: `blackbox effects baseline update --run <run-id>`. It selects a named source run; it does not settle every target or baseline subject detail. Inspect installed help and the current package contract before using it, and stop if the target cannot be identified safely. Do not use a latest-run default, a historical `effects update --flow` proposal, a Playwright snapshot flag, or a guessed target option.

A baseline update changes acceptance material. Do it only when the current task authorizes the specific change. Afterward, inspect the actual changed files and run a fresh test against the new reference when that verification is requested. An update command is not a verification run, and it does not rewrite the result of the source run.

Keep narrow assertions alongside broad comparison where both serve a purpose. A baseline refresh must not delete an independent invariant or hide a missing observation boundary. If the new candidate contradicts the accepted requirement, report the conflict as a behavior or product decision.

Return the exact run ID, baseline target, accepted requirement, relevant difference, capture limits, changed files if updated, and fresh-run status. If you cannot identify the source run or baseline target, stop at review and state what is missing.
