# Draft a Feature from Markdown

Start with a requirement that describes an observable outcome. Blackbox drafting should preserve its meaning, not rewrite the product to match the current implementation.

```markdown
## REQ-101: Create a subscription
For an eligible customer with no subscription, a valid request
returns HTTP 201 and stores exactly one subscription.
```

## Draft, then review

The proposed CLI entry is:

```sh
blackbox spec draft --file requirement.md
```

This is a [planned interface](../status.md). In the source preview, the coding agent performs the same authoring task through its instructions and the available compiler/vocabulary.

The draft should identify the source requirement, selected system, initial state, stimulus, completion condition, and explicit checks. Unknown business rules stay questions. Do not invent a retry deadline, refund policy, authentication rule, or expected status code merely to produce a complete-looking Feature.

## Translate intent without hiding the evidence choice

“Stores one subscription” needs a state check. “Requests payment” can require an observed outgoing request or a controlled payment endpoint's record. “Completes fulfillment” needs evidence from the completion boundary, not just a queue send.

Choose the smallest system that contains the behavior. Record any test double or excluded dependency that limits the claim. Discovery helps locate interfaces; the spec decides what their outcomes should mean.

## Review the draft

Review whether each scenario represents an accepted requirement, whether concrete values make the example understandable, and whether each assertion could detect a plausible wrong implementation. Reject a draft that replaces a state claim with only a response assertion or makes every error an allowed result.

Preserve requirement identities when available. The audited Feature tag grammar accepts `REQ-<n>`. For sources using `FR-001` or `US1/AC2`, keep an explicit source-to-Feature mapping rather than pretending those identifiers are interchangeable or renumbering them on every run.

## Existing Features

Do not overwrite existing scenarios blindly. Reconcile a proposed change with the current reviewed artifact. A generic Gherkin step may be readable but unsupported by Blackbox's closed vocabulary; adaptation needs review of meaning as well as syntax.

Next: [Feature files](feature-files.md) · [Spec Kit](../integrations/spec-kit.md).

---

[Documentation](../README.md)
