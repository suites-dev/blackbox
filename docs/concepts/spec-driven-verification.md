# Spec-Driven Verification

**Start with what we agreed the system should do. Run the system. Check what it actually did.**

As agents take on more implementation work, we need a repeatable way to check behavior alongside
code review. A spec gives the implementation and its checker a shared, human-reviewed target. Its
meaning should survive changes to classes, functions, and internal organization.

The specification may be Markdown, a ticket, an API contract, or a document owned by an SDD
workflow. Blackbox doesn't replace it. It helps coding agents turn that accepted behavior into tests
that exercise the real running application.

## Why the testing boundary matters

**The application runs its implementation. The test interacts with the application.** A Blackbox
system test sends input through a running application's interface, such as HTTP. It does not import
a business class into the test process and invoke its methods as the entrypoint.

That is why the framework is called **Blackbox**. The checks describe what the system returns,
changes, and does against the accepted behavior. Testing through those interfaces makes the
separation between specification and implementation practical: an agent can change the code's
internal structure while the same expectations continue to apply.

For the product rule, the test creates and retrieves a product through the API, inspects its
PostgreSQL and Redis state, and observes the database/cache operations during retrieval. The rule
constrains those interactions. It need not name a service class or repository method.

Some teams call these integration tests. The term includes both
[code-level interactions and tests across live services](https://martinfowler.com/bliki/IntegrationTest.html).
Blackbox's contribution is the system preparation, isolation, observation, and feedback workflow
that lets agents repeat these checks against an accepted specification.

Run the real participants needed inside the **verification boundary**. Record external or
substituted dependencies and what their substitution leaves unverified. Removing PostgreSQL from the
cache example would remove the very interaction the test must check.

## Maintain the machinery without redefining success

A Feature is durable when it describes system behavior, not merely because it uses Gherkin. If
agreed interfaces and behavior stay the same, changing an ORM or reorganizing classes need not
change the expectation. Client bindings, startup configuration, state readers, and instrumentation
may still need maintenance.

Keep that maintenance separate from changing the behavioral contract. An agent may repair an
observer that stopped recording database reads; changing the expected read count to accept a cache
bypass would change the requirement and needs review.

## One specification, three things to keep connected

Suppose we agree:

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving a valid cached entry
> must not read PostgreSQL.

<p align="center">
  <img width="790" src="../assets/readme/specification-triangle.svg" alt="An accepted product specification, optional Gherkin Feature, and generated Playwright suite preserve the same cache behavior." />
</p>

The **spec** describes what should happen. The **test** expresses a concrete example. The **run**
tells us whether that example held in one real execution. A passing test cannot prove that every
requirement in the source document has been covered.

The full [developer journey](../guides/from-spec-to-verification.md) places human review before
system discovery. The agent then uses Capsule experiments to learn which observations actually work
before turning the approved behavior into repeatable Playwright checks. Capsule exploration is
useful, but isn't mandatory when the selected system and assertions are already known.

## Write checks in two ways

<p align="center">
  <img width="790" src="../assets/guides/authoring-paths.svg" alt="Accepted specifications can become direct native Playwright tests or optional reviewed Gherkin Features that compile to Playwright." />
</p>

- **Native Playwright:** TypeScript tests using SDK clients to interact with the running system's
  interfaces and inspect its resources.
- **Optional Gherkin Feature:** readable `Feature → Rule → Scenario` examples, reviewed before
  Blackbox generates a native suite.

A short Feature can express a request and its response:

```gherkin
Feature: Product creation
  Scenario: Create a product
    When client "api" sends POST "/products" with JSON:
      """json
      { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
      """
    Then the response status is 201
```

**That only checks the response.** The complete
[product example](../guides/verify-a-specification.md) also checks storage, cache state, and the
application's database operations.

## Three different ways things drift

| Relationship                  | What can go wrong?                               | How to check                     |
| ----------------------------- | ------------------------------------------------ | -------------------------------- |
| **Spec → test**               | We miss or misunderstand a requirement           | Review against the accepted spec |
| **Feature → generated suite** | The TypeScript no longer matches the Feature     | Deterministic generation check   |
| **Test → system**             | The implementation no longer behaves as expected | Run against the isolated system  |

For the Feature path, the candidate compiler can check the generated suite:

```sh
# In the product-cache sample, with the PR #181 APIs and sample available
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

This checks **generated files**, not the running system.
[Feature maintenance](../features/generating-test-suites.md).

## The important human boundary

Two separate questions matter. **Is the spec itself right?** Someone must clarify and approve the
behavior. **Does the implementation meet the spec?** Blackbox gives the agent an environment and
observations to check selected behaviors.

If the test fails, the agent should investigate the code or the observation setup. It should not
change a requirement to make the test green without review.

When the reason for a failure is unclear, the agent can explore with a
[Capsule](../../packages/capsule/README.md). An experiment may suggest a new test, but it doesn't
automatically define acceptable behavior.

<p align="center">
  <img width="790" src="../assets/readme/capsule-to-feature.svg" alt="A Capsule supports experimentation; a developer reviews candidate expectations before recording them as repeatable Playwright verification." />
</p>

Blackbox can work from ordinary Markdown or integrate with an existing process such as
[Spec Kit](../integrations/spec-kit.md). Spec Kit owns the specification; Blackbox owns the runtime
check. The integration itself is planned, not shipped.

**Specifications define intent. Executions produce evidence. Verification connects them.**

[Why this matters in agentic development](why-verification-now.md) ·
[Investigate with a Capsule](../guides/investigate-with-capsule.md)
