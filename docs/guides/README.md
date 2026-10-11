# Testing guides

Choose a guide for the task you are doing. For your first run, use the
[complete native tutorial](../getting-started.md).

| Task                           | Guide                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Turn a requirement into a test | [From specification to verification](from-spec-to-verification.md) |
| Connect your application       | [System setup](../playwright/connect-your-application.md)          |
| Investigate an unknown         | [Capsule experiments](investigate-with-capsule.md)                 |
| Understand a failed attempt    | [Reports](reports.md)                                              |
| Repeat checks automatically    | [CI verification](ci-verification.md)                              |
| Review an expectation change   | [Contract review](../contracts/reviewing-changes.md)               |

## Product-cache case study

These guides explain how to check different parts of one requirement. Their typed
client API is from a candidate revision, and the product sample is not supplied
in this checkout. [Check availability](../alpha-status.md) before using the code.

- [Case study](verify-a-specification.md): map persistence, caching, and no-read claims to evidence.
- [HTTP](testing-http-apis.md): send the action and assert the response.
- [PostgreSQL](testing-postgres.md): inspect the committed row independently.
- [Redis](testing-redis.md): distinguish stored cache state from cache-only retrieval.
- [Asynchronous work](testing-async-flows.md): wait only when the requirement permits it.
- [Repair exercise](repair-from-evidence.md): diagnose a correct response with an unwanted database read.

[Evidence concepts](../concepts/behavioral-evidence.md) · [Reference](../reference/README.md)
