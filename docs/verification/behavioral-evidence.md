# Behavioral evidence

Blackbox focuses on what the running system does at the boundaries relevant to an accepted requirement: responses, retained state, service interactions, and downstream work.

## A behavioral claim is not a call graph requirement

“Checkout charges the accepted total and saves the order” is a behavioral claim. “The controller calls method A before method B” is normally an implementation constraint. Do not turn every observed internal step into a required contract simply because telemetry can expose it.

An internal refactor may change algorithms, object structure, or service composition while preserving the required boundary behavior. A boundary behavior may also fail because of an internal change. Choose the test level from the question, not from which file changed.

## Required and forbidden behavior

Positive claims require appropriate witnesses: a saved subscription, a response, or an observed outgoing request. Negative claims such as “no second payment was requested” need sufficient coverage of the relevant boundary and a meaningful completion condition.

“No duplicate subscription is stored” and “no duplicate payment request occurred” are different claims. The first is about state; the second is about an interaction history. Checking only final state can miss a duplicate external action that was later compensated.

## Bound the claim

Write down the selected system, starting state, unique business data, action, expected outcomes, and completion condition. If a real external service is replaced, describe what the test verifies about the interaction with the replacement and what remains outside its scope.

For example, a payment test double can expose a request ledger. That ledger can help check how the local system called the payment boundary; it cannot prove the production provider settled funds.

## What not to promise

Blackbox does not automatically record all internal function calls, infer all business semantics, or prove full implementation equivalence. Supported runtime observations are one input to verification, not a complete recording of everything that happened.

Use unit tests for isolated calculations, and focused integration tests for internal collaborations. Use Blackbox when the requirement concerns the running application or subsystem and its real execution conditions.

Next: [System boundaries](../systems/system-boundaries.md) · [Evidence](evidence.md).

---

[Documentation](../README.md)
