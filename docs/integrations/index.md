# Integrations

Blackbox does not require a specification-development toolkit. Ordinary Markdown, accepted requirements, and directly authored Playwright tests remain supported entry paths in the product model.

An SDD integration changes where intent comes from, not how Blackbox runs the selected system or retains evidence.

```text
Markdown ---------> agent drafts ----+
                                    |
Spec Kit ----------> thin bridge ----+--> reviewed Feature
                                             |
                                          compile
                                             |
Native Playwright ---------------------------+--> fresh Sandbox
                                                       |
                                                    evidence
```

## Spec Kit

The [Blackbox Spec Kit guide](spec-kit.md) defines the optional `blackbox-spec-kit` handoff. Spec Kit remains responsible for its specifications, clarification, plans, tasks, and development process. Blackbox supplies executable system checks, Capsules, Sandbox execution, and behavioral evidence.

The extension described there is the agreed integration design, not an npm package or catalog entry established by this documentation change. The [availability page](../status.md) separates that design from implemented preview commands.

## Another specification source

Use the [Markdown drafting workflow](../specifications/from-markdown.md). Keep a stable reference to the original document and record explicit requirement-to-scenario mappings. Do not create a second product spec merely to satisfy a directory convention.

Gherkin from another tool can be input to review, but its steps must still resolve to Blackbox's closed vocabulary. Syntactically valid Gherkin is not necessarily executable by Blackbox.

## Existing tests

Adopt the [native Playwright integration](../playwright/index.md) without a spec generator. Keep accepted expectations in the test and link them to their source where available. The generated-Feature consistency checks apply only to generated suites, not to arbitrary native tests.

## Pages in this section

- [Blackbox with Spec Kit](spec-kit.md)

---

[Documentation](../README.md)
