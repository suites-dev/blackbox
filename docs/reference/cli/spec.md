# Specification drafting command

**Proposed interface.** Drafting is currently an agent workflow; this audit did not establish an implemented `spec` command family.

```sh
blackbox spec draft --file requirement.md
```

## Meaning of draft

Read an identified source specification and prepare candidate Feature scenarios using the installed vocabulary. A draft must distinguish requirements, inferred examples, assumptions, and unresolved questions. It is not approved merely because a tool wrote it.

The source specification remains authoritative. Review the draft before compiling or accepting its checks. Preserve source requirement identity through explicit mappings; do not claim all prose has been verified.

## Inputs and outputs

The proposed `--file` identifies the source document. Output-path, overwrite, JSON, model-provider, and approval flags are not specified by an audited implementation and are intentionally not invented here.

The intended output is reviewable behavioral scenarios plus their source links and remaining gaps. It is not an independent product specification. Existing Features should be reconciled through a reviewed change rather than overwritten indiscriminately.

## SDD sources

The [Spec Kit bridge](../../integrations/spec-kit.md) supplies the active feature context and delegates to the same drafting procedure. Plain Markdown remains a first-class route with no Spec Kit dependency.

## Not a proof command

A semantic review can identify missing or conflicting scenarios; hashes cannot establish that the scenarios fully express the prose. The source preview's `feature verify` checks run and compile consistency, not arbitrary specification meaning.

Next: [From Markdown](../../specifications/from-markdown.md) · [Feature commands](feature.md).

---

[Documentation](../../README.md)
