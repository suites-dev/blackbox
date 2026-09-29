# Async boundaries and terminal evidence

There are three distinct gaps: command execution can end while work continues;
trace propagation can break while work remains in the Capsule scope; and relevant
work can be uninstrumented. Do not treat them as the same failure.

A bounded procedure identifies initial state, one deliberate stimulus, a unique
business ID, accepted terminal predicate, business deadline, telemetry deadline
and cleanup. Register an output subscriber before sending when necessary. Use
isolated queue names or subscriptions. Poll the predicate, not elapsed time alone.
A deadline is a bound on what was established, not proof that work never happens.

Business completion and telemetry export have independent conditions. Retain the
command activity and inspect session-wide records for separately traced downstream
work. Known initial state, exclusive stimulus and matching business IDs may support
a scoped behavioral attribution. Shared session membership or timestamps alone
do not establish span parentage or exact causal attribution under concurrency.

Stateful inspection matters. Removing a message with a destructive queue read or
ack changes the environment. Use a dedicated test consumer, record the operation,
and account for it during reset and cleanup. Read-only state queries can also
produce instrumentation spans; keep inspection separate from stimulus effects.

Preserve application retry and redelivery behavior. Do not disable it just to
obtain a stable example. Avoid competing consumers and stale messages; record
visibility timeout, delayed delivery, dead-letter behavior and attempt identity.
A witness from a previous retry cannot satisfy the current physical attempt.

An occurrence witness can establish that a matching output existed. Exact counts,
absence, no future work and exactly-once claims need stronger capture and closure
conditions. A quiet collector or one output does not supply those guarantees.
The audit must retain these limitations rather than fabricating an all-settled
signal or a universal `until` command.

See [queue flow](../diagrams/queue-flow.mmd) and
[the queue example](../examples/queue/README.md).
