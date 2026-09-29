---
name: blackbox-audit
description: Return a versioned discovery audit and check it against independent execution records.
---

# Discovery audit

Read [the audit contract](../../references/audit-contract.md). Always emit an audit,
even when the task is blocked, denied, failed or only partially completed.

## Procedure

1. Use the closed [audit schema](../../schemas/discovery-audit.v1.json). Select
   explicit variants for absent catalog, unselected boundary, unrun execution,
   blocked stages and incomplete outcomes. Do not omit required properties.
2. Preserve source facts, inferences, unresolved questions, access approvals,
   graph layers, environment requirements, boundary rationale and limitations.
3. Keep catalog validity, acquisition, readiness, setup, stimulus, terminal
   witness, observation and cleanup separate. Operability refers to the accepted
   claim; it is not a global health or correctness grade.
4. Take receipt identities from runner-owned records, not from an invented example.
   Normalize with the installed CLI's documented envelopes. Keep raw sanitized
   records available; this bundle does not implement a universal CLI normalizer.
5. Run the local contract checker against the audit and supplied receipt bundle.
   Missing, duplicate, stale, unrelated or inconsistent receipts are failures.
6. Treat checker acceptance as structural/record consistency only. The caller
   must authenticate receipt provenance and inspect the actual terminal predicate.
   A hash identifies content; it does not establish who produced it.

## Return

Return the audit, sanitized record references and actionable next steps. Keep the
human summary proportional: selected boundary, what actually ran, terminal result,
confidence limits and cleanup. Do not expose secrets, private payloads or raw
command output that has not been screened for sensitive content.
