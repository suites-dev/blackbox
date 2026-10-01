# Discover trace continuity boundaries

Use this reference during static discovery when a request can return before a
worker, queue, or scheduled task finishes, or when the requested claim may cross
more than one trace. Discovery maps the boundary and the evidence gap; Capsule
owns an authorized live completion procedure.

## State the completion claim

Draw the path in the selected catalog scope: input request or message, queue, consumer, downstream state, and terminal output. State whether the claim is about request acceptance, message publication, receipt, processing, durable state, or user-visible completion. These facts are separate.

A 202 response is not proof that a job completed. A producer send is not proof that a consumer received it. Consumer receipt is not proof that durable state was written. Pick a terminal witness that matches the requested claim: correlated output, a documented completion signal, expected state, or user-visible result.

## Preserve identity distinctions

Record execution identity, visible domain identifiers, supported propagation
links, and source-backed completion signals as separate facts. A trace continuity
gap can leave the initiating activity and a consumer's work on separate traces
within one execution. Describe that evidence as unlinked async work or an
unlinked downstream trace; do not manufacture direct parentage.

Known state, an exclusive stimulus, and a trustworthy unique marker may support
a system-level behavioral claim. Under concurrency, timestamps, user IDs, or
queue names alone do not establish one physical attempt or direct span causality.
Bind a Playwright witness to the exact physical attempt; a result from a prior
retry cannot complete the current retry.

## Keep completion axes separate

Business completion and telemetry delivery are different boundaries. A producer
send is not consumer receipt, consumer receipt is not durable state, and a stable
effects projection does not establish remote completion unless the application
contract defines that relationship. Fewer observations do not establish an
exact count when relevant capture is incomplete.

## Route live validation

When live validation is authorized and the `capsule` skill is available, hand it
the selected boundary, terminal condition, expected timeout, correlation facts,
and known gaps. Capsule owns polling, subscriber ordering, destructive-read
safety, reset, observation, and cleanup. If Capsule is absent, finish static
discovery and mark the live claim blocked rather than importing or inventing its
procedure.

Return the selected boundary, candidate terminal condition, identity and
correlation facts, source-backed completion signals, and remaining gaps. Do not
invent a product `until` command, a DSL flag, or a generic “wait for all async
work” operation.
