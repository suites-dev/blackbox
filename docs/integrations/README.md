# Specifications and SDD integrations

A specification does not have to live inside Blackbox. Markdown, product requirements, tickets, API contracts, and SDD workflows can all supply **accepted intent**.

Blackbox connects that intent to executable expectations and evidence from running software. It does not become the authority for rewriting a requirement just because an implementation fails.

| Starting point                                 | Handoff                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ordinary Markdown or ticket                    | Agent proposes executable expectations; the developer approves them                   |
| Native Playwright                              | Tests are reviewed against the accepted behavior and executed directly                |
| Optional Gherkin                               | The Feature is reviewed, validated, compiled, and checked for suite drift             |
| [Spec Kit](spec-kit.md) or another SDD process | The existing workflow owns specification/planning; Blackbox owns runtime verification |

[Spec Kit](spec-kit.md) is a proposed thin integration design, **not an installed or published extension in this alpha**. Vanilla Blackbox requires no Spec Kit installation.

[Spec-Driven Verification model](../concepts/spec-driven-verification.md) · [Verify a specification](../guides/verify-a-specification.md)
