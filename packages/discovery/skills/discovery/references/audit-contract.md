# Discovery audit and record contract

Use the bundled JSON Schema 2020-12 contracts for audits, inspector fragments and
receipt bundles. The audit is an output artifact, not an application catalog.

Record mode and requested task, revision, selected or absent catalog and digest,
source/inference/runtime/unresolved evidence, graph, boundary, environment input
requirements, independent stage outcomes, limitations and next actions.
An exercise includes the accepted predicate and business identity. Inventory does
not invent a behavior to test.

Keep catalog validity, acquisition, readiness, setup, stimulus, terminal witness,
observation and cleanup distinct. A requested live stage blocked by a missing
Capsule integration must remain blocked. A source-only inventory may complete
without claiming runtime operability.

Receipts come from actual runner-owned records and retain revision, catalog
digest, session, physical attempt, activity identity, screened artifact reference
and content digest where relevant. A hash is not proof of provenance. A command
exit is not a terminal witness, a configured observer is not capture evidence, and
successful cleanup does not erase a failed experiment.

These copied assets provide schemas and illustrative examples. The installed
`@suites/blackbox-discovery` package separately exports `validateAudit(audit, receipts)`
and `validateInspectorResult(fragment)` as executable TypeScript/ESM APIs. The
package loads its own bundled schemas through its public skill descriptor; the
copied instructions do not contain executable helpers. No standalone audit CLI,
automatic receipt normalizer or provenance authentication is provided.

`validateAudit` returns `kind: 'accepted'` with qualification
`structure-and-receipt-links-only`, or `kind: 'rejected'` with diagnostics. Acceptance
checks structure and receipt linkage, never authenticates the supplied evidence or
proves live behavior. Report the validator result and review evidence separately.

Keep examples (including their example provenance) separate from live results.
Retain screened audit artifacts under a project-owned output directory such as
`.blackbox/discovery/<audit-id>/`, preserving earlier attempts.
