# Show renderer fixtures

`recorded-capsule.json` is one real capsule, recorded end to end and then sanitized. The renderer
snapshots in `../snapshots/` are rendered from it by `../show-snapshots.test.ts`.

## How it was captured

1. `bash e2e/bash/capsule-assets.sh` (packed CLI, e2e SUT with its catalog as committed).
2. In a fresh journey project, with the packed CLI:

   ```sh
   blackbox capsule up --silent --no-color --env FIXTURE_CONTROL_TOKEN=<random>
   blackbox capsule run --via public-api --purpose setup --name "Reset fixture" -- curl -fsS -X POST \
     -H "Authorization: Bearer $FIXTURE_CONTROL_TOKEN" -H "Content-Type: application/json" \
     -d '{"profile":"fresh"}' /fixture/reset
   blackbox capsule run --via public-api --name "Create Alice subscription" -- curl -fsS -X POST \
     -H "Content-Type: application/json" \
     -d '{"userId":"alice","paymentMethodId":"pm_capsule_alice"}' /subscriptions
   blackbox capsule run --via redis --name "Queue proof stimulus" -- redis-cli RPUSH blackbox:proof:stimuli proof-journey
   # wait until `blackbox capsule show <that activity>` prints "no known cause"
   blackbox capsule run --name "Check health" -- sh -c 'curl -fsS "$BLACKBOX_CAPSULE_ENTRYPOINT_URL/health"'
   blackbox capsule run --name "Check health again" -- sh -c 'curl -fsS "$BLACKBOX_CAPSULE_ENTRYPOINT_URL/health"'
   blackbox capsule run --name "Check health once more" -- sh -c 'curl -fsS "$BLACKBOX_CAPSULE_ENTRYPOINT_URL/health"'
   blackbox capsule down
   ```

3. After `down`, into `.blackbox/tmp/show-recording/` at the repository root (a fixed, git-ignored
   directory): `blackbox capsule show <capsule> --json` as `session.json`,
   the capsule's `session.json` and `activities.json` as `record.json` and `activities.json`, and
   `blackbox capsule show <trace> --session <capsule> --json` for every retained trace as `trace-<id>.json`.
4. `node sanitize-recording.mjs > recorded-capsule.json` (it reads only that directory).

Sanitizing keeps structure and relative timing and replaces every identifier (capsule, activity,
trace and span IDs; collector instance and execution IDs), shifts times so the capsule starts at
2026-01-01T00:00:00Z, and drops each activity's argv, output and remediation text. Spans are stored
as `projectInvestigationSpans` projects them, so their attributes are already bounded and redacted.

## Scenarios

| Snapshot                    | Source                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `activity-sent.txt`         | "Create Alice subscription": context sent, full tree, uncaused traces   |
| `activity-shared-state.txt` | "Queue proof stimulus": shared-state driver, nothing observed           |
| `activity-untraced.txt`     | "Check health once more": host command without a driver                 |
| `activity-orphan.txt`       | "Create Alice subscription" with its server span removed, capsule running |
| `trace.txt`, `trace-spans.txt` | the "Create Alice subscription" trace                                |
| `capsule.txt`, `capsule-timeline.txt` | the whole capsule                                             |

More than three uncaused traces follow the first activities, so their views also show the
`⚠ … <n> more traces` line. The orphan scenario is derived in the test (not recorded), because a
real run only shows it transiently.
