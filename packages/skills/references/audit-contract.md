# Discovery audit and record contract

`discovery-audit.v1.json`, `inspector-result.v1.json` and
`receipt-bundle.v1.json` are closed JSON Schema 2020-12 contracts. Every property
in a selected variant is required. TypeScript models use readonly objects and
explicit discriminators. The audit is not the application's catalog.

## Shape

The audit records mode/task, project revision, selected/absent catalog and digest,
approvals, source/inference/runtime/unresolved evidence, layered graph, behavioral
boundary, environment input requirements, execution identity, independent stages,
operability, overall outcome, limitations and next actions.

An `exercise` task includes the accepted claim, entry/terminal nodes, required
observation nodes, unique business ID and deadline. An inventory or preflight
must not silently invent that claim. The same shape represents blocked and failed
work through explicit variants rather than optional properties.

| Field | Variants |
| --- | --- |
| Mode | `initial`, `reconcile` |
| Task | `inventory`, `preflight`, `exercise` |
| Stage | `not-run`, `not-required`, `blocked`, `failed`, `passed` |
| Operability | `not-assessed`, `operable`, `inoperable`, `inconclusive` |
| Overall outcome | `complete`, `incomplete`, `blocked`, `failed` |
| Confidence | `unknown`, `low`, `medium`, `high`, always with reasons |
| Evidence | `source`, `inference`, `runtime`, `unresolved` |

`not-required` is a justified absence of a required operation, such as no setup
mutation for an already-fresh fixture. It cannot replace required stimulus,
terminal, observation or cleanup steps to manufacture a complete live result.

## Receipts and authority

Receipts are supplied separately from the agent's audit. A receipt identifies
revision, catalog digest, Capsule/physical attempt where relevant, recorded
activity when applicable, sanitized artifact reference and content digest.
Command, terminal, observation and cleanup records have distinct variants.

An integration must normalize the actual installed CLI/runtime envelopes and
retain their raw sanitized records. This bundle supplies the target record
contract and consistency checks, not a universal adapter for every CLI version.
The caller must authenticate runner ownership/provenance. The checker does not
read arbitrary receipt paths or assert that a hash is genuine.

A process exit zero is only command evidence. A terminal receipt needs the
accepted predicate's result, node and unique business ID. An observation receipt
names actually captured nodes; declaration/activation alone is insufficient.
A cleanup receipt distinguishes released from remaining owned resources.

## Checked invariants

The executable checker rejects unknown shapes and properties, duplicate/dangling
IDs, circular inference chains, unauthorized cross-repository source assertions,
invalid substitutions, open prerequisite closure, high confidence with unresolved
required dependencies, operability without a completed behavioral exercise,
complete live results without observation/cleanup, and mismatched or missing
receipt scope/activity/witness identities. Check acceptance is explicitly
`structure-and-receipt-links-only` and retains `example` versus `runner` provenance.

It does not authenticate approvals/receipts, prove capture completeness, decide
arbitrary business predicates, scan a repository or start resources. Keep these
trust boundaries in the host integration. An independently accepted predicate and
fresh real evidence are still required to establish that the selected SUT works.

The schema interpreter is restricted to the bundled vocabulary, local `$defs`
references, depth 64 and arrays of at most 10,000 entries. Its CLI additionally
bounds input bytes and never echoes submitted JSON on error. It is not a general
remote-schema validator. The published schemas can also be used with a standard
JSON Schema 2020-12 validator for detailed local diagnostics.

## Artifact convention

A project can retain audits and screened references in its own
`.blackbox/discovery/<audit-id>/` directory. This is a suggested output location,
not a new Blackbox runtime API. Keep generated evidence out of authoritative
configuration and preserve older attempts. Do not publish credentials or private
traces. The example files are illustrative contracts, not recorded test runs.
