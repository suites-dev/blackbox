# Follow work across async holes

An **async hole** is a gap in the trace relationship across an asynchronous handoff: the work continues, but the
context connecting it to the initiating action does not. A producer might write a Redis list item, a database row,
or a file that a worker reads later. If that handoff does not carry trace context, the worker can start another trace.

Blackbox retains both the commands you execute and supported application traces within the Capsule session. You can
investigate the whole execution even when it cannot be represented as one continuous trace.

## Redis can be the entrypoint

An experiment does not have to begin with HTTP or a browser. In the included application, a Redis list is an input
to a running worker. The extended Bash journey exercises this path:

```text
Capsule session
│
├─ Recorded activity: redis-cli RPUSH blackbox:proof:stimuli <marker>
│    └─ Activity trace A; process result; propagation: context-not-supported
│
├─ Redis list item contains the marker, with no trace-context carrier
│    └─ redis-proof-consumer takes the item using BLPOP
│
└─ Separate observed trace B
     ├─ redis-proof-consumer: POST /fixture/shared-state-proof/<marker>
     └─ public-api: receives that request
```

The arrows through Redis describe the fixture's application behavior. Blackbox does not manufacture a parent span
between trace A and trace B. The consumer and API spans are collected under the same session, and the marker in the
HTTP path helps identify the relevant downstream work.

The catalog's HTTP `entrypoint` still supplies the startup URL and readiness check. It does not restrict experiments
to HTTP stimuli: a configured driver can reach another participant, including Redis.

## Push one identifiable stimulus

Complete the [subscription walkthrough](experiments.md) through startup and keep its Capsule running. That setup
provides the driver SDK, instrumentation, Redis, `redis-proof-consumer`, and `public-api`, with a shared fixture token.
Use its `SESSION_ID`. In the following example, run the stimulus once; choose a new marker if you repeat it.

```sh
PROOF_ID="shared-state-$SESSION_ID"
redis_result=$(blackbox capsule exec --session "$SESSION_ID" \
  --name 'Queue shared-state proof' --driver redis --purpose stimulus --json -- \
  redis-cli RPUSH blackbox:proof:stimuli "$PROOF_ID")

printf '%s' "$redis_result" | jq .
REDIS_ACTIVITY_ID=$(printf '%s' "$redis_result" | jq -er '.activityId')
```

The driver runs the supplied `redis-cli` arguments inside the Redis participant. The command output is the Redis
list length after the push; its successful exit records that the push succeeded, not that the consumer finished.
The result records `context-not-supported` at the shared-state boundary. This is expected for this driver and payload,
so `--allow-untraced` is unnecessary.

## Look beyond the activity trace

First inspect the stimulus's activity:

```sh
blackbox observations --session "$SESSION_ID" --activity "$REDIS_ACTIVITY_ID" --json
```

After telemetry arrives, the example's activity trace contains the activity root. The consumer's HTTP work is on a
different trace, so it will not appear simply by querying this activity. Query the session and inspect its traces:

```sh
session_observations=$(blackbox observations --session "$SESSION_ID" --json)
printf '%s' "$session_observations" | jq .

for trace_id in $(printf '%s' "$session_observations" | jq -r '.traceIds[]'); do
  blackbox observations --session "$SESSION_ID" --trace "$trace_id" --json
done
```

Look for `/fixture/shared-state-proof/` followed by your marker, reported by `redis-proof-consumer` and `public-api`.
The matching trace should differ from the stimulus activity's trace. Delivery is asynchronous; if it has not arrived,
repeat the session query and inspect the new results. A single early empty query does not show that nothing happened.
For scripted checks, use a bounded wait for the specific evidence and report missing evidence on timeout.

The [Bash journey](../e2e/bash/capsule-test.sh) takes a session snapshot before the stimulus, polls for the marked
consumer-to-API trace, and checks that both traces remain in the session and reports. Its
[evidence check](../e2e/bash/capsule-telemetry-proof.mjs) keeps the downstream association as `session-only`.
That is a limit on recorded trace correlation, not a reason to discard the observed request.

## Decide what the execution establishes

| Observation                                                             | What it supports                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Successful `RPUSH` command result                                       | The supplied list write succeeded.                                                                                           |
| Consumer and API spans with the marker                                  | The marked downstream HTTP interaction was observed within this execution.                                                   |
| Controlled input, known setup, and the corresponding marked interaction | A system-level claim that this trial's Redis stimulus resulted in the expected worker behavior, subject to those conditions. |
| Separate activity and consumer trace IDs                                | Trace continuity across this handoff was not established.                                                                    |

One marker observed in the expected services is useful evidence of occurrence. It does not establish exactly-once
processing, absence of retries, or completion of every possible downstream task. Those claims need additional checks
and appropriate completion and coverage conditions. Shared session membership alone does not establish that an
arbitrary command caused an arbitrary span, especially when a Capsule contains several stimuli.

Stop the Capsule when finished and retain its report using the [walkthrough's final steps](experiments.md#save-a-snapshot-stop-and-inspect-again).

## Distinguish three different gaps

| Gap                                                                         | What to inspect next                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Trace continuity is missing, but downstream spans exist.                    | Use the session view, visible business identifiers, and controlled conditions to assess the claim.                        |
| The relevant runtime operation is not instrumented.                         | Add an appropriate observation source or an authoritative state check; a session cannot recover an uncollected operation. |
| Command execution finished, but downstream work or export is still pending. | Wait for the application's completion signal and required evidence within a defined timeout.                              |

Queues can carry trace context when the producer, message format, and consumer support it. This Redis example
demonstrates a handoff that does not. Blackbox preserves that limitation alongside the evidence it did collect.
See [runtime evidence](runtime-evidence.md) for claim-specific completeness and [drivers](drivers.md) for command preparation.
