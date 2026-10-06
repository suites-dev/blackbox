# Run a Capsule experiment

Define the question before starting resources. Identify the selected system, known state, one stimulus, the observations and state reads required, a completion condition, and the expected cleanup.

## Start and retain the identity

```sh
blackbox catalog validate
blackbox capsule up subscription-system --json
```

Read the returned session ID, including an admitted failed startup. Use that exact ID for subsequent commands; do not select the newest session by timestamp. In the following commands, set `SESSION_ID` from that real result.

## Act deliberately

```sh
blackbox capsule run --session "$SESSION_ID" --purpose stimulus \
  --via public-api -- curl --fail-with-body /health
```

This command assumes a project driver named `public-api` that adapts the relative URL, as in the repository fixture. A driver is not a built-in HTTP client and does not install curl. Use the project's documented driver arguments.

Keep seeding or migrations as separate `--purpose setup` activities, and reads as `--purpose inspection`. Purpose labels are descriptive; they do not prevent side effects.

## Inspect

```sh
blackbox observations --session "$SESSION_ID"
blackbox capsule show --session "$SESSION_ID"
```

Inspect the process result, required state, and observation availability independently. Check session-wide observations when a downstream handoff may have continued on another trace. Do not repeat a non-idempotent write while waiting for a result.

## Report and stop

```sh
blackbox capsule report export --session "$SESSION_ID" --format html
blackbox capsule down --session "$SESSION_ID" --json
```

In an agent or shell workflow, cleanup belongs in a failure-safe finalization path. A failed report export must not skip cleanup; successful cleanup must not erase a failed experiment. Inspect the cleanup outcome rather than assuming `down` returned the desired state.

## Repair and confirm

When authorized, repair the implementation, reload or rebuild the relevant runtime, re-establish starting conditions, and rerun the same accepted procedure. Record the new revision and identities. Do not change the expected behavior simply because the repaired application produced a different result.

Once the useful expectation is reviewed, retain it as a Feature or a [native test](../agents/authoring-verification.md). Fresh confirmation must not depend on the old Capsule's accumulated state.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/references/capsule-experiments.md).

---

[Documentation](../README.md)
