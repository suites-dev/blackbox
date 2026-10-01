# I/O, configuration and control boundaries

## Behavioral input and terminal witness

| Input                       | Candidate terminal witness                                                 | Common mistake                                                         |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| HTTP/RPC call               | Accepted response plus required durable state or downstream output         | Treating HTTP 202 or a health route as completion                      |
| Queue/topic message         | Matching output message, committed result or application completion record | Equating producer acknowledgement with consumer completion             |
| Stream record               | Matching output event at a defined offset/partition scope                  | Ignoring prior offsets, replays and consumer-group state               |
| CLI/subprocess invocation   | Exit/result plus required external effect                                  | Assuming exit zero proves all spawned work finished                    |
| Scheduled job               | Explicitly triggered execution with a matching terminal record             | Waiting for a wall-clock cron occurrence without controlled time/state |
| Database/shared-state write | Triggered workflow's durable result                                        | Assuming a write/commit proves downstream processing                   |
| File/object-store change    | Matching produced object/state with version/identity                       | Seeing an old filename and calling it a new result                     |
| Webhook                     | Verified local delivery and matching application result                    | Calling an external production endpoint to test local setup            |

A test may use several inputs and exits. Record which terminal nodes and predicates
are required and which are merely diagnostic. Prefer an application-owned
completion condition over a generic wait for "all async work".

## Configuration is not secret material

Discover names, config schemas, safe defaults and references. Store availability
as present/missing/unknown. Resolve actual credentials only in the authorized
execution environment; do not copy them into catalog examples, audits, argv,
logs or reports. Do not infer missing values from names or silently use developer
production credentials.

A local PostgreSQL password is still a secret while the container is
Capsule-owned. A SaaS API might use workload identity rather than a visible API
key. A signing key can be internal application state. A secret-free public API can
still be an unmanaged dependency. Classify ownership, lifecycle, reset ability,
external contract and substitution independently.

Record service names/aliases and protocol/container ports from safe sources.
Host endpoints come from acquisition results. Different network namespaces have
different `localhost`; matching port numbers do not establish communication.
Preserve network memberships, external endpoints, host mounts and shared storage
as distinct facts. Never put raw `docker inspect` environments in the audit.

## State and reproducibility

Track migrations, initial rows/objects, queue/topic creation, unique namespaces,
reset operations and cleanup ownership. Reused containers need explicit state
reset or isolation. Scheduled tasks, retries, outboxes and delayed messages can
survive the initiating command. A fresh CLI process is not fresh system state.

For managed/unmanaged discussions, use the audit's explicit lifecycle field.
State whether a selected external dependency is actually outside local control,
even when its API is owned by the same team. Avoid silently translating a cloud
service's deployment label into a testing-control claim.
