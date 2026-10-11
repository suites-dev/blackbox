# Keep the behavior alongside the code

A behavioral contract records **what must remain true when the implementation changes**:
what the application returns, what it changes, and which interactions it must or must not perform.
Blackbox exercises the running system through I/O and checks those expectations.

The contract is not every observation from a passing run. **Observed results are evidence;
reviewed expectations are the contract.**

<picture>
  <source media="(max-width: 640px)" srcset="../assets/contracts/behavioral-contract-mobile.svg" />
  <img src="../assets/contracts/behavioral-contract.svg" width="900" alt="Source specification informs reviewed scenarios, executable output and state checks, and an accepted effects baseline. Fresh system execution is compared with those expectations." />
</picture>

## One behavior, related artifacts

The proposed sibling layout makes that relationship visible:

```text
create-payment.feature            reviewed scenarios; optional
create-payment.blackbox.test.ts    executable setup, actions, output/state checks
create-payment.effects.yaml       accepted effects snapshot; planned
```

These filenames illustrate ownership, **not a released discovery convention or a runnable payment
example**. The product-cache guides remain the worked example.

The original Markdown or SDD specification owns the intended behavior. The Feature describes
selected examples. The TypeScript performs the test and its assertions. An accepted effects file
would add the runtime interactions to preserve. Together they express one contract, not three
competing specifications.

`create-payment.state.yaml` is still under discussion. **Keep state assertions in the test today**;
there is no agreed state-file schema, generator, or extra file requirement.

## What makes the artifacts durable?

Tests enter through application interfaces, not private business methods. A class refactor can
preserve the same response, saved state, and required downstream interactions. Client bindings and
observers may still need maintenance; that does not authorize changing the expected behavior.

Effects snapshots must preserve that distinction too. Do not freeze every internal function span,
timestamp, identifier, or incidental operation. Select interactions that the specification requires
or that a reviewer deliberately accepts as additional constraints.

[Why the testing boundary matters](../concepts/spec-driven-verification.md#why-the-testing-boundary-matters).

## From a recorded run to an accepted baseline

```text
Capture an execution → propose effects → review against intent → accept a baseline
                                                                  ↓
Fresh execution ────────────────────────────────────────────── compare
```

Recording can be automatic. **Acceptance must be deliberate.** An agent must not repair a failing
check by accepting the implementation's new behavior as the baseline.

A Capsule can help discover useful observations. The final Playwright test must reproduce its own
initial state and collect fresh evidence; it does not borrow a successful Capsule run.

## Both authoring paths use the same model

A deterministic Feature suite stays generated and unedited. A native suite is project-owned
TypeScript, including tests that did not begin as a new Feature. Accepted effects expectations are
separate from either suite's generated-versus-authored status.

**Snapshot comparison is planned.** Its schema, scenario association, selection/normalization,
commands, and default capture/opt-out behavior are not settled by these docs. There is no implied
snapshot matcher available today.

[Effects snapshots](effects-snapshots.md) · [Reviewing changes](reviewing-changes.md) ·
[Developer workflow](../guides/from-spec-to-verification.md)
