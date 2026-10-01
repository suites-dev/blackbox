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

## `recorded-run.json`: the `capsule run` block

`recorded-run.json` is a second real capsule, recorded the same way (same commands, step 2 above) with
the phase 2b CLI, whose span projection keeps `db.system.name` and `rpc.system`: the run tree needs them
to tell database, message and RPC client spans from other client spans. `recorded-capsule.json` predates
those keys and stays as it is for the `show` snapshots.

`sanitize-recording.mjs` now also writes each trace's `arrivals`: for every span, the time the collector
received the fragment that carried it (`receivedAt`, shifted like every other time). The run snapshots
replay arrival from it: "what had arrived N ms after the child exited" keeps the spans whose arrival is
at or before the activity's `completedAt` plus N.

The run renderer snapshots in `../../run/testing/snapshots/` are rendered from it by
`../../run/testing/run-block.test.ts`, with the capsule set back to `running` (as `run` sees it):

| Snapshot                   | Source                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `run-sent.txt`             | "Create Alice subscription", every span arrived: filtered tree, 4 uncaused traces   |
| `run-tty-redraw.txt`       | the same, drawn at child exit, at +165 ms and with everything, then the final block |
| `run-wait-0.txt`           | the same at child exit (`--wait 0`): nothing had arrived yet                       |
| `run-still-arriving.txt`   | the same at +165 ms with the wait ended by its cap                                  |
| `run-nothing-observed.txt` | the same with none of its trace's spans                                             |
| `run-shared-state.txt`     | "Queue proof stimulus": shared-state driver, uncaused proof trace                   |
| `run-untraced.txt`         | "Check health once more": host command without a driver                             |
| `run-orphan.txt`           | "Create Alice subscription" without its server span (derived, like `activity-orphan`) |
| `run-many-spans.txt`       | its trace with every span below the activity copied three times (derived, >40 lines) |
