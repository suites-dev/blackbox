# Test asynchronous workflows

Use this reference when a request returns before a worker, queue, or scheduled task finishes, or when the claim depends on an observation window.

## State the completion claim

Draw the path in the selected catalog scope: input request or message, queue, consumer, downstream state, and terminal output. State whether the claim is about request acceptance, message publication, receipt, processing, durable state, or user-visible completion. These facts are separate.

A 202 response is not proof that a job completed. A producer send is not proof that a consumer received it. Consumer receipt is not proof that durable state was written. Pick a terminal witness that matches the requested claim: correlated output, a documented completion signal, expected state, or user-visible result.

## Bound the wait

Use the application's supported completion signal or a bounded poll over read-only state. Choose a deadline that matches the system's expected response and the CI budget. A timeout means the completion condition was not established within that interval; it does not prove the operation will never complete.

A fixed sleep is not an observation that distributed work is settled. Repeating a non-idempotent request until a desired result appears can create the effect being asserted. Keep diagnostic polling separate from the product action and avoid allowing repeated queries to inflate effect counts.

## Isolate and correlate

Use unique test data and an owned queue or namespace where the acquisition driver supports it. Understand visibility timeouts, redelivery, deduplication, retries, delayed jobs, and fixture reset. Preserve application retry behavior instead of disabling it to make a test stable.

Follow one producer-recorded identity or supported propagation link through the path. Do not join independent events by timestamp, user ID, or queue name. Under concurrency, those fields are not enough to identify one physical attempt.

For Playwright, bind each terminal witness to the exact physical attempt. A consumer action from a prior retry cannot complete the current retry. Keep all retry artifacts and identify which attempt supplied the displayed result.

## Interpret absence and counts

A matching counterexample can refute an upper bound when its identity and scope are established. Fewer observed occurrences do not establish an exact count if relevant capture is incomplete. A closed observation window applies only to that window and the stated scope; it does not prove that a scheduled task will never run later.

Distinguish waiting for telemetry delivery from waiting for business completion. A stable effects projection says nothing about whether a remote job has finished unless the application contract makes that relationship explicit.

Return the selected boundary, terminal condition, timeout, correlation, actual witnesses, and remaining gaps. Do not invent a product `until` command, a DSL flag, or a generic “wait for all async work” operation.
