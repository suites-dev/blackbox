---
name: blackbox-io-environment
description: Discover behavioral ingress/egress and safe configuration, secret references, ports and network requirements.
---

# I/O and environment discovery

Read [I/O and environment](../../references/io-environment.md).

## Procedure

1. Identify behavioral inputs and terminal outputs for HTTP/RPC, CLI/processes,
   queues/topics, streams, scheduled jobs, database/shared-state triggers,
   files/object stores and webhooks. Keep startup readiness separate from stimulus.
2. Record producer, consumer, protocol, resource identity, namespace and the
   authority of each terminal witness. Queue publication and queue consumption
   are separate operations; a protocol driver is not an application assertion.
3. Inspect variable names, configuration schemas and secret references. Record
   presence/missing/unknown without printing or retaining secret values. Safe
   non-secret connection facts can be represented as resource/edge evidence.
4. Resolve service/container ports separately from host publications, DNS aliases,
   Compose project networks, Kubernetes services, ingress and external endpoints.
   `localhost` means the current network namespace, not another participant.
5. Classify ownership, Capsule lifecycle control, substitutability and behavioral
   relevance independently. A credential reference alone cannot decide them.
6. Identify initial-state, migration, namespace and reset requirements. Record
   shared writable state, timers, outboxes, retries and late work before reducing.

## Return

Populate graph/evidence/environment fields. Record proposed entry, terminal and
observation nodes for boundary selection. Unknown secret values are normal;
unknown requirements are blockers. Use the available `capsule` skill's async route when
completion extends beyond the initiating command.
