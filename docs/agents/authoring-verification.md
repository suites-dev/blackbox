# Authoring verification

A durable test should preserve accepted behavior, not an incidental execution path discovered during debugging. Start with the requirement and make each important expectation observable.

## Draft the scenario

State the initial conditions, one deliberate stimulus, the completion condition, and the claims. Use concrete values. Identify the system boundary and distinguish infrastructure readiness from completion of the behavior under test.

A vague requirement such as “subscriptions are reliable” needs clarification. Do not silently replace it with “the response is 201” and report the requirement covered.

## Choose the representation

Use a Feature when the shared [step vocabulary](../reference/feature-vocabulary.md) expresses the behavior. Use native Playwright when code is a better representation. Native tests remain first class; they do not need to be reverse-generated into Gherkin.

For a generated suite, the Feature and reviewed library determine the executable checks. Do not add project step definitions, edit generated output, or invent a supported step to bypass a capability error.

## Review expectations before confirmation

An experiment can reveal a candidate scenario, but cannot authorize its expected result. Review the scenario against the source requirement. Preserve requirement identity and the reviewable mapping even when a source uses a different ID namespace.

For the strict Gherkin workflow, keep specification changes separate from implementation changes according to the project policy. A changed timeout, completion deadline, or selected scenario can change the meaning of the check and also needs review.

## Make the check discriminating

Ask which plausible bug would make the test fail. A persistence claim needs a state assertion; logging an INSERT is not enough. A duplicate-prevention claim needs counts or identities and an adequate completion boundary, not just two successful process exits.

Do not weaken a failed assertion, add retries, or omit a test to make the run green. A deliberate expectation change is a separate specification decision.

## Confirm with fresh evidence

Compile accepted Features using the installed CLI, run the relevant Playwright tests in fresh Sandboxes, and inspect the actual attempt results. For the guarded Feature workflow, run the post-run verification command too. A discovery list or generated file is not evidence of execution.

Keep local selection explicit and leave broader confirmation to CI. Link the final report to the source revision, selected system, scenario, and attempt. Report unsupported or unexecuted claims rather than filling the gaps with prose.

Next: [Feature authoring](../specifications/feature-files.md) · [Native tests](../playwright/writing-tests.md) · [CI](../playwright/ci.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/references/capsule-experiments.md).

---

[Documentation](../README.md)
