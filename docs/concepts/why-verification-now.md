# Why verification matters when agents write the code

AI can generate or rewrite a lot of software quickly. That changes the developer's job: **we still
have to decide what the software must do, but we can no longer rely on personally understanding
every implementation detail before it ships**.

Blackbox starts with a practical question: **how can an agent repeatedly check the running
implementation against the behavior we agreed on?**

<p align="center">
  <img width="790" src="../assets/readme/human-agent-verification-loop.svg" alt="The developer approves intent and the coding agent implements, inspects execution feedback, repairs the code, and reruns accepted checks." />
</p>

## Keep the intended behavior independent of the implementation

An agent may replace a class, switch an ORM, or rewrite a service. Those changes shouldn't require
rewriting a business rule that hasn't changed.

A _specification_ is where we state the intended behavior. An _executable check_ tests a concrete
example of it against the running system. That gives an agent a target more stable than a particular
code structure.

Blackbox makes this separation practical by testing through the running system's I/O interfaces. The
test sends an HTTP request rather than importing the application's business class. It can check
responses, stored state, and required runtime interactions while the agent reorganizes the code
behind that interface. This is the idea behind the name **Blackbox**.

The agreed interfaces and behavior define what must remain stable. Client bindings and observation
setup may need maintenance without changing those expectations.
[Why the testing boundary matters](spec-driven-verification.md#why-the-testing-boundary-matters).

[Leonardo de Moura's essay on AI-generated software](https://leodemoura.github.io/blog/2026-2-28-when-ai-writes-the-worlds-software-who-verifies-it/)
argues that specification becomes a core engineering discipline as implementation accelerates. It
advocates **formal proof**. Blackbox takes a different, complementary route: **runtime system
testing with evidence**, not mathematical guarantees.

Specs themselves can be incomplete or mistaken. Implementation may reveal requirements we didn't
anticipate. **Change an accepted spec through review—not as an automatic response to a failed
test.**

## Give an agent a language it can check

Free-form prompts are useful for discussing intent, but they aren't durable executable acceptance
criteria by themselves.

A reviewed Gherkin Feature makes scenarios easy to read. More importantly, **Blackbox uses a
constrained set of executable sentences**: the compiler can reject unsupported steps instead of
leaving the agent to invent their meaning.

```text
Accepted requirement
        ↓
Reviewed Feature (or native Playwright)
        ↓
Validation and executable system test
        ↓
Results the agent can act on
```

This follows the value of constrained, validated DSLs discussed in
[Unmesh Joshi's article](https://martinfowler.com/articles/llm-and-dsls.html). Gherkin supplies
structure; **Blackbox's supported step library** is what constrains execution. Native Playwright
remains first-class when a claim needs richer SDK calls.

[Feature files and the step vocabulary](../features/README.md)

## A passing response needs the right question

Software testing has a classic problem: **how do you know whether a result is correct?** Researchers
call this the _test oracle problem_. An agent that sees HTTP `200` has an observation, but it may
not have checked the full requirement.

Consider the cache rule in our [product walkthrough](../guides/verify-a-specification.md). The right
response can conceal an unwanted PostgreSQL query. We need to check stored state and the
application's operations—not just the response body.

<p align="center">
  <img width="790" src="../assets/guides/product-cache-evidence.svg" alt="Two implementations return the same product, but the cache-bypass implementation also queries PostgreSQL and violates the accepted requirement." />
</p>

The foundational [survey of test oracles](https://ieeexplore.ieee.org/document/6963470) explains why
identifying correct outcomes is a separate problem from generating test inputs. Blackbox doesn't
automatically solve the oracle problem; it provides the controlled execution and observation
mechanisms needed to implement meaningful checks.

[How to choose evidence](behavioral-evidence.md)

## Make the next check cheaper than the next rewrite

A useful verification loop should be **repeatable, targeted, and low-noise**. Blackbox selects a
runnable system boundary: sometimes the full application, sometimes the smaller subsystem that still
contains the behavior and evidence needed by the test.

A [Capsule](../guides/investigate-with-capsule.md) gives an agent room to experiment when the cause
of failure is unclear. **Native Playwright** keeps the reviewed expectation as a durable regression
check and CI gate.

This is our application of two ideas:
[narrowing hard-to-verify problems](https://www.kipiiler.me/blog/verification-systems-llms-ai-agents)
into testable environments, and
[front-loading verification work](https://www.jasonwei.net/blog/asymmetry-of-verification-and-verifiers-law)
so later solutions can be checked more easily. Neither essay specifies Blackbox's Docker boundaries
or implies every software problem becomes cheap to verify.

<p align="center">
  <img width="790" src="../assets/readme/capsule-to-feature.svg" alt="A Capsule supports experiments, while developer review determines which expectations become permanent executable tests." />
</p>

The payoff isn't _more tests for their own sake_. It's a coding agent that can implement, obtain
specific feedback, repair, and check again—**without redefining success each time**.

[Give your agent the first task](../playwright/connect-your-application.md) ·
[Run the product example](../guides/verify-a-specification.md)
