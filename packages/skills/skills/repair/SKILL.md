---
name: blackbox-repair
description: Diagnose a failed discovery or Capsule stage without weakening the accepted behavior.
---

# Repair router

Classify the first unsupported or failed stage, then route narrowly:

| Failure | Route |
| --- | --- |
| CLI/schema not available | [Capability resolution](../../references/capabilities.md) |
| Contradictory or missing configuration | [Reconcile](../reconcile/SKILL.md) |
| Missing process/resource or wrong subsystem | [Boundary](../boundary/SKILL.md) |
| Build/network/port/env/readiness failure | [Infrastructure](../infrastructure/SKILL.md), [I/O](../io-environment/SKILL.md) |
| Stimulus ran, no terminal result | [Async](../async/SKILL.md), then application diagnosis |
| Terminal result exists, telemetry missing | Check activation/exporter/collector compatibility and observation scope |
| Resource leak | Stop only the owned Capsule; preserve IDs and failed cleanup evidence |

Inspect actual command envelopes and error records. Distinguish a Blackbox tool
failure from a delegated process failure. Change one supported cause at a time,
keep edits within authorization, restore initial state, and rerun the unchanged
accepted procedure. Never hide failure by removing participants or boundaries,
changing the predicate, disabling retries or using stale successful receipts.

Return a fresh incomplete/failed/complete audit. Keep prior attempts intact and
link limitations instead of rewriting history.
