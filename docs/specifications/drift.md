# Specification and suite drift

Keep three different questions separate:

```text
Source requirement  -> Feature       Does the scenario preserve the intent?
Feature + compiler  -> Suite         Is this still the derived executable output?
Suite               -> Running app   Does this execution satisfy the checks?
```

## Source-to-Feature alignment

This is a semantic review. Stable requirement links help locate affected scenarios, but a hash cannot determine whether “only one active subscription” was weakened to “a subscription exists.” A traceability matrix cannot establish that the assertion would detect a duplicate.

Treat an agent's alignment assessment as a review result with limitations, not a deterministic runtime verdict. Blackbox's planned drafting/SDD interface should surface uncovered and ambiguous requirements.

## Feature-to-suite consistency

The Feature is authoritative over generated code. The incoming compiler records feature hashes, generated-file hashes, step-library identity, and scenario metadata. These can detect stale or modified artifacts under the compiler's recorded contract.

The proposed `blackbox feature suite check` names this concern. It is not an implemented alias in the audited branch. In the incoming preview, completed-run consistency is part of:

```sh
blackbox feature verify --config blackbox.feature.yaml
```

That command is supplied by PR #165 and runs after Playwright. It checks run/compile identity, required scenarios and requirements, policy, and whether inputs changed since compile. `feature check` is a different project-restriction check.

## What to do when consistency fails

If the Feature intentionally changed, review it and compile again. If generated code was edited, discard that edit through the project's normal review workflow and regenerate; do not promote it back into the Feature automatically. If the compiler or step library changed, review that upgrade and rerun against fresh output.

Never repair a mismatch by editing a manifest hash or copying a newer timestamp into a report. A changed input invalidates evidence derived from the old input.

## Execution policy drift

Changing selection, retries, timeouts, workers, or cleanup limits can change what a green run means. The incoming reporter compares effective settings against a reviewed baseline. A focused local run is useful but is not equivalent to the full approved CI scope.

The planned GitHub Action should call the same CLI checks as local runs. CI must not silently regenerate evidence or approve changed expectations to make itself green.

Next: [CI](../playwright/ci.md) · [Run identity](../playwright/execution-and-retries.md).

## Source contract

[Gherkin verification](https://github.com/suites-dev/blackbox/pull/165) · [Runner policy](https://github.com/suites-dev/blackbox/pull/155).

---

[Documentation](../README.md)
