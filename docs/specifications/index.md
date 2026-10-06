# Executable specifications

A specification says what should happen. An executable specification connects an accepted expectation to an action and checks that can run against the system.

```text
requirement -> reviewed Feature -> compiled Playwright -> isolated run
                                                          |
                                                       evidence
```

Blackbox can start from ordinary Markdown, an existing test, or an [SDD integration](../integrations/index.md). Spec Kit is optional. Native Playwright remains a first-class path when code is the better representation.

## The artifacts have different roles

The source requirement owns intent. A Feature refines that intent into concrete scenarios using a supported step vocabulary. The generated suite is build output. A run supplies evidence about the scenarios that executed under its conditions.

Do not edit generated tests to repair a failing expectation. Review the Feature when the requirement changes; repair the implementation when it violates the existing requirement.

## Workflow

Start with [drafting from Markdown](from-markdown.md), then [review Feature files](feature-files.md), [validate their executable meaning](validate.md), and [emit the Playwright suite](emit-playwright.md). Use [drift checks](drift.md) to keep the accepted Feature, generated output, and run aligned.

The proposed terminal sequence is `spec draft` -> `feature validate` -> `feature suite emit`. The incoming source preview uses `feature compile`, plus separate project/run checks. The [command map](../status.md) is the authority for which spelling exists at the audited revision.

## What execution does not establish

A passing example is not proof of every sentence in the product document or every possible execution. A requirement-to-scenario link establishes traceability, not test strength. Keep uncovered requirements, assumptions, unsupported steps, and excluded environments visible.

## Pages in this section

- [Draft a Feature from Markdown](from-markdown.md)
- [Feature files](feature-files.md)
- [Validate a Feature](validate.md)
- [Emit and run a Playwright suite](emit-playwright.md)
- [Specification and suite drift](drift.md)

---

[Documentation](../README.md)
