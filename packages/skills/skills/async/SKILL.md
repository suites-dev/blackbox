---
name: blackbox-async
description: Establish bounded terminal completion for queue, stream and other asynchronous Capsule behavior.
---

# Asynchronous completion

Read [async boundaries](../../references/async-boundaries.md).

## Procedure

1. Draw the selected path: ingress resource, producer/consumer, state changes,
   downstream work and terminal output. Name exactly what completion means.
2. Establish fresh isolated input/output namespaces and one unique business ID
   for this physical attempt. Register an output observer before stimulus when
   an ephemeral subscription could otherwise miss the result.
3. Send once. Distinguish send acknowledgement, delivery, receipt, durable commit
   and end-to-end completion. Use a deadline-based poll or application completion
   signal for the exact expected witness.
4. Make polling read-only where possible. Consuming/acknowledging an output queue
   is a state-changing inspection; use a dedicated test subscription/namespace,
   retain its action, and include it in cleanup. Do not steal production messages.
5. Preserve retries, duplicate delivery, visibility timeouts, delayed work and
   separate traces. A trace gap is not an execution gap, and neither is resolved
   by inventing parent spans or joining solely by time proximity.
6. Wait separately for business completion and required telemetry delivery. Quiet
   telemetry, a health endpoint, producer ACK or fixed sleep is not completion.
7. On timeout, report "not established within the deadline". Absence and exact
   counts need appropriate coverage and closure; one witness establishes neither
   exactly-once processing nor absence of future delayed work.

## Return

Keep terminal identity, deadline, observation limitations and cleanup distinct.
For queue-to-worker-to-output-queue claims, assert the output queue payload and
business ID, not only a consumer log or a successful input write.
