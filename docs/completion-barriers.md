# Seal asynchronous work before asserting effects

An effects assertion is meaningful only after the tested flow has an observable completion boundary. Blackbox calls
that boundary a **seal**. A seal closes the work that belongs to one test; it is not a timer that waits for the system
to become quiet.

```ts
await assignments.send({ videoId: 'video-42' });
await assignments.drain({ videoId: 'video-42' }); // completion barrier

await expect(effects).toSatisfy((effect) => [
  effect.exactly(1, effect.message({ operation: 'process', destination: 'assignments' })),
  effect.exactly(1, effect.message({ operation: 'send', destination: 'videos.discovered' })),
]);
```

The driver API and effect projection in this example are planned. The Playwright Alpha exposes the attempt-scoped
effects contract boundary, but it does not yet project raw telemetry into normalized effects.

Use this page when a system test crosses a queue, worker, scheduler, webhook, or another boundary where the initiating
call can finish before the tested behavior finishes.

## Close the behavioral flow explicitly

A system can execute asynchronously. A Blackbox test must not leave its tested flow open.

```text
stimulus ──▶ asynchronous work ──▶ completion witness ──▶ sealed effects ──▶ assertion
                                      ▲
                                      │
                         queue drain, terminal job state,
                         checkpoint, or terminal response
```

The completion witness depends on the system boundary:

| Boundary under test                 | Useful completion witness                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Synchronous request handler         | The terminal response, if the handler awaits every in-boundary operation before responding.                          |
| Queue consumer                      | The input queue has no visible, delayed, or in-flight work for the test, and the consumer has acknowledged the item. |
| Durable job                         | The test job reaches a terminal `completed` or `failed` state.                                                       |
| Stream processor                    | The consumer checkpoint passes the test record's offset or sequence.                                                 |
| Workflow or saga                    | A terminal workflow event or durable state transition carries the test's business identity.                          |
| Queue at the system's exit boundary | Successful publication is the terminal effect; downstream consumption is outside this system boundary.               |

The same queue can require different seals in different tests. If the queue is the selected system's output, publishing
the message may close the flow. If the selected system includes the consumer, the test must wait through consumption
and acknowledgement.

## Drain all queue states, not only visible messages

A queue that reports zero visible messages may still have work in flight. A useful drain checks every state that can
retain the test's work:

```ts
const attributes = await queue.getAttributes([
  'ApproximateNumberOfMessages',
  'ApproximateNumberOfMessagesNotVisible',
  'ApproximateNumberOfMessagesDelayed',
]);

const drained = attributes.visible === 0 && attributes.inFlight === 0 && attributes.delayed === 0;
```

The implementation should also fail on a bounded deadline. A timeout is a failed completion barrier, not permission
to inspect a partial effect set.

For a shared queue, zero global depth may still be the wrong proof. Prefer a test-owned queue, namespace, correlation
identifier, checkpoint, or another witness that identifies the tested work without depending on unrelated producers.

## Do not replace completion with quiet time

These signals do not seal a flow by themselves:

| Signal                       | Why it is insufficient                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `sleep(5000)`                | Time passing does not prove that work completed.                                         |
| One empty queue poll         | A message may be delayed, invisible, or about to be produced.                            |
| HTTP `202 Accepted`          | It usually confirms admission, not completion.                                           |
| A root span ended            | Detached work can continue after the initiating span.                                    |
| No new telemetry arrived     | Collector quietness is an observation property, not an application completion condition. |
| The expected effect appeared | Later work may still duplicate, compensate, or contradict it.                            |

Polling is appropriate when it polls a real completion condition, such as a terminal job state or queue drain. The
condition provides the proof; polling only provides the waiting mechanism.

## Keep behavior completion separate from evidence delivery

The application or its driver owns the completion witness. Blackbox owns collection after that witness.

Once the flow is sealed, Blackbox must finish the observation boundary needed for the effects contract. It may flush
instrumentation, wait for a collector watermark, or use another protocol-specific acknowledgement. That mechanism is
infrastructure. Test authors should not guess an export delay.

If Blackbox cannot establish that the required evidence is complete, an absence or cardinality claim must be
**inconclusive**. It must not pass because the current snapshot happens to be empty.

## Write the test as stimulus, seal, assertion

For synchronous work, the response can be the seal:

```ts
const response = await request.post('/subscriptions', {
  data: { userId: 'alice', paymentMethodId: 'pm_alice' },
});

expect(response.status()).toBe(201); // handler returned after its required work

await expect(effects).toSatisfy((effect) => [
  effect.exactly(1, effect.db({ operation: 'INSERT', table: 'subscriptions' })),
  effect.exactly(1, effect.message({ operation: 'send', destination: 'subscription-orders' })),
]);
```

For a consumer, expose the domain-specific barrier through a driver instead of embedding queue internals in every
test:

```ts
await assignments.publish({ assignmentId: 'assignment-42' });
await assignments.drain({ assignmentId: 'assignment-42' });

await expect(effects).toSatisfy((effect) => [
  effect.exactly(1, effect.business({ operation: 'assignment.completed' })),
  effect.absent(effect.message({ destination: 'assignments.dead-letter' })),
]);
```

The driver should report what it observed while sealing the flow. It should not hide a timeout, silently discard
messages, or treat a best-effort empty result as completion.

## Review a proposed seal

Before relying on a completion barrier, answer these questions:

1. What exact work belongs to this test?
2. Which observable state proves that work cannot continue inside the selected system boundary?
3. Does the witness cover queued, delayed, retried, and in-flight work?
4. Can unrelated producers or consumers make the witness ambiguous?
5. Does timeout fail the test instead of returning partial evidence?
6. After the witness, how does Blackbox establish complete observation for absence and exact-count claims?

Continue with [async holes](async-workflows.md) for trace continuity across shared-state handoffs and
[runtime evidence](runtime-evidence.md) for the evidence required by occurrence, absence, and cardinality claims.
