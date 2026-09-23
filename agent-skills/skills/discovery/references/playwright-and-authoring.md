# Author native Playwright journeys

Use this reference when the task asks for a repeatable test or a native Playwright journey. Playwright remains the test runner. Alpha supports Node applications and JavaScript/TypeScript Playwright projects; it does not require or add a Blackbox test-runner wrapper.

## Turn a request into test obligations

Read the product requirement, selected catalog entry, related application tests, and any exact experiment evidence. An experiment supplies candidate actions and observed behavior; it does not decide what the application should do. If the expected result is missing or conflicts with an existing requirement, identify the decision instead of changing assertions to match the latest observation.

Write a short test outline before editing:

- selected system or subsystem and the path the test covers;
- initial data and who owns it;
- action and user-visible terminal condition;
- ordinary response or application-state assertions;
- runtime effects needed for the claim;
- what remains unobservable or outside the test.

Choose the full system when the behavior crosses all of its participants. Choose a subsystem when a smaller queue-to-worker, service-to-database, or similar slice answers the request. Use a browser journey for user-facing behavior, not merely because the system has several services. A subsystem result does not imply that an excluded entrypoint or service passed.

For each expectation, choose an appropriate source. An HTTP response is a native assertion. A supported client observation may witness a request or statement. Persisted values generally require an application-state assertion or another source that can establish the values. A producer send does not prove consumer completion. Avoid broad statements such as “everything worked” when the evidence covers only dispatch.

## Use the supported public integration

Inspect the installed Alpha package exports, the project's Playwright version, existing configuration and fixtures, and current public documentation before importing helpers or adding Blackbox-specific hooks. Historical examples may name APIs that are not in the installed release. Keep the system selection in the catalog and use the actual integration’s public SUT-selection API; do not introduce a second SUT ID authority in test metadata.

Use Playwright's normal command, typically the project's existing `npx playwright test` invocation. Keep Capsule usable without Playwright setup. Do not add a `blackbox test`, suite runner, or other wrapper.

An action boundary should identify the operation whose runtime effects are being assessed. Await evidence retrieval and use the public matcher or projection supported by the installed package. Do not convert a retrieval error into an empty list or a bare user-filtered array into complete capture. Read exact evidence fields through their versioned public schema.

Keep runtime checks alongside ordinary assertions. A response assertion and an effect assertion answer different questions. A successful test process with a failed runtime evaluation is a different result from a failed Playwright assertion; report each axis as the producer recorded it.

## Make data independent

Arrange unique, deterministic inputs for each test or physical attempt. Do not depend on an earlier Capsule, another test's cart, ordering between workers, or a row left by a previous run. Document the reset, transaction, namespace, or cleanup strategy. Worker reuse changes resource lifetime; it does not make shared state independent.

Use fixtures for setup and cleanup, and keep setup requests distinct from product behavior. Do not silently classify harness traffic as a product effect. Browser network calls may follow a different instrumentation path than Node's direct API client; verify the path before relying on it.

Include meaningful alternative or error paths when they are part of the requested contract. One happy-path request cannot establish that every alternative is handled. Do not claim coverage for a path the test did not execute.

## Retries and physical attempts

A Playwright retry is a new physical attempt with its own execution identity and evidence. Retain all attempts, including a failed first attempt followed by a pass. The final runner status does not make the earlier failure disappear.

When diagnosing retry behavior, select evidence for the exact scenario, project, SUT, and attempt. A delayed observation from attempt A cannot satisfy attempt B. Do not borrow a witness from another worker or use the newest retained artifact to fill a missing ID.

Keep the original test selection, projects, retry count, shard/repeat settings, and timeouts visible when comparing results. Removing a project, changing a grep, increasing retries, or widening a timeout changes what was tested. Do not make such a change merely to obtain a green run without stating the changed scope.

## Baselines and optional diagnostics

Effects baselines are separate acceptance references. Read [effects and baselines](effects-and-baselines.md) before creating or updating one. A baseline does not replace targeted response, state, or runtime assertions.

ODC is optional Post-Alpha diagnostic work. Do not add decision capture configuration or ODC as an Alpha acceptance prerequisite. An absent or unavailable diagnostic must not fail the ordinary Playwright journey.

## Report the result

Return changed files, exact native invocation, selected system and test scope, every relevant physical attempt, native status, runtime result, retained IDs/paths, limitations, and cleanup. If you authored a suite but could not run it, say so. A report or screenshot alone is not proof that all selected tests executed.
