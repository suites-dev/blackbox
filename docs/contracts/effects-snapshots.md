# Effects snapshots and baseline review

Use effects to check runtime interactions and keep a reviewable record of what a
scenario observed. An effects baseline preserves the interactions required by the
accepted specification alongside response and state assertions.

For example, two versions of a cached-product endpoint may return the same JSON,
but one also queries PostgreSQL. That additional operation violates the accepted
cache-hit rule even though the response is correct.

![A valid cache read and a broken cache bypass return the same product, but only the latter reads PostgreSQL.](../assets/guides/product-cache-evidence.svg)

The product-cache case study describes an observation design; its application and
observers are not included. The same requirement can guide an effect contract
when the relevant telemetry is captured with sufficient scope and coverage.

## Evaluate runtime interactions

`@suites/blackbox-effects` projects decoded OTLP JSON into an effect graph, compiles
constraints, and evaluates the graph against them. In Playwright, use the
`effects` fixture with `expect(effects).toSatisfy(...)`.

| Assessment     | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `pass`         | The selected evidence establishes the constraint.                                 |
| `fail`         | The evidence contradicts the constraint, such as an observed forbidden operation. |
| `inconclusive` | The available evidence cannot establish the constraint.                           |

A required operation that was not observed in an open capture remains
inconclusive. The same applies to exact counts and absence claims without
sufficient completeness evidence. Negation does not turn uncertainty into success.

An observed database statement does not establish commit; an outgoing payment
request does not establish settlement. Keep the response and authoritative state
checks the requirement needs.

## Record a snapshot for review

The standalone package also provides `createEffectsRecord` and
`serializeEffectsRecord`. Install it directly when your code imports these APIs:

```sh
npm install --save-dev @suites/blackbox-effects@alpha
```

An effects record groups counted observations within one Playwright attempt or
Capsule activity. Its experimental `v0` format is separate from the effect graph
and executable contract. It records observations without retaining effect order
or proving that an unrecorded effect never occurred.

```text
OpenTelemetry observations
        ↓  select relevant interactions and preserve their scope
Candidate effects record
        ↓  review against the accepted specification
Accepted runtime expectations
        ↓  evaluate fresh observations against the same contract
Assessment + observation limitations
```

Keep the record's source identity and completeness status with it. Stable
serialization makes records reviewable; it does not automatically approve them
or turn them into executable assertions. The record schema is exported at
`@suites/blackbox-effects/schema/effects-record-v0.json`.

## Review before accepting a baseline

<picture>
  <source media="(max-width: 640px)" srcset="../assets/contracts/snapshot-review-mobile.svg" />
  <img src="../assets/contracts/snapshot-review.svg" width="900" alt="Captured effects are a candidate until reviewed. Accepted expectations are compared with a fresh execution; differences lead to investigation, not automatic baseline updates." />
</picture>

**First capture is not first acceptance.** Review the initial state, stimulus,
system boundary, and completed observation window before accepting an expectation.
A normal verification run checks the contract; it must not silently rewrite it.
A missing baseline is not an established match.

## Keep comparisons meaningful

| Concern                      | Review question                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Scenario and action identity | Which test, parameterized case, and stimulus does the record describe?       |
| Variable values              | Are meaningful relationships preserved when unstable values are excluded?    |
| Ordering and retries         | Does the evidence establish the ordering the requirement actually needs?     |
| Scope                        | Can application behavior be distinguished from setup and inspection traffic? |
| Observation availability     | Is capture sufficient for this claim, or is the result inconclusive?         |
| Observer changes             | Did behavior change, or did instrumentation expose different information?    |
| Sensitive data               | Have credentials and private payloads been excluded from committed records?  |

A baseline with no SQL effects cannot establish “no PostgreSQL read” by itself.
That claim also needs adequate observation coverage and completion.
[Absence evidence](../concepts/behavioral-evidence.md#why-absence-is-harder-than-presence).

## Review changes rather than recording success

An added interaction may be a bug, an intended requirement change, or a change in
what the observer can see. Investigate before updating expectations. Changes to
selection or normalization can weaken the check just as changing a TypeScript
assertion can.

[Reviewing changes](reviewing-changes.md) · [CI verification](../guides/ci-verification.md) ·
[Reports](../guides/reports.md)
