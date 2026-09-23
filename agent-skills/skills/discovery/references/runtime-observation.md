# Plan runtime observation

Use this reference when a catalog is valid but an application effect may not be observable, or when planning a safe first live probe.

## Start from the claim

Write the requested fact narrowly and identify the application participant expected to produce its witness. An HTTP request accepted by a caller, an HTTP request received by another service, a database statement, a committed row, and a queue consumer completing work are different claims. Select an observation boundary that can support the one being asked.

Record each relevant participant's runtime and startup path, client library, instrumentation owner, collector route, and required correlation path. Distinguish “package installed,” “bootstrap referenced,” “bootstrap loaded in the correct process,” “telemetry delivered,” “effect correlated to this execution,” and “claim qualified.” These are separate facts.

A service declaration and readiness success are setup facts, not capture evidence. A library dependency or configuration path suggests support but does not prove the actual operation flowed through an instrumented client.

## Respect ownership

Alex owns application instrumentation, bootstrap modules, runtime SDK dependencies, and the Node instrumentation factory. Keep those resources in the application’s tracked `.blackbox/instrumentation/` area and inside the application dependency or image graph. Blackbox does not ship application-library instrumentation such as HTTP frameworks, Kafka, databases, or clients.

Blackbox owns the generic OTLP intake, execution-scoped endpoints and routing, activation coordination, correlation validation, retained evidence, qualification, deterministic evaluation, and report projection. A Blackbox-owned activation adapter starts the Alex-owned Node factory before application imports and supplies only the execution-scoped context and endpoint described by the accepted runtime contract.

The versioned activation lifecycle and exact Node factory signature are still provisional in the activation contract. Inspect the installed, versioned public contract before authoring a factory export, lifecycle methods, or catalog adapter fields. Do not copy a speculative function signature from an issue draft, propose your own ABI in a bootstrap, or import an OpenTelemetry SDK into Blackbox to make an example work.

Alpha runtime support is Node. Keep the catalog plan and evidence model language-neutral. Java, Python, other Playwright clients, and non-Compose acquisition remain future adapter work. Do not imply that they can be activated by copying the Node setup.

## Trace the capture path

Check the instrumentation references and startup ordering for the relevant service. The factory must load in the process that uses the supported application library and before its imports initialize that library. Confirm the project's build output and tracked file path are available inside the application environment.

Confirm that the application participant can reach the execution's OTLP endpoint, that the generic receiver accepts the transport, and that the captured resource and correlation context bind observations to the correct execution and participant. Preserve existing process startup options; a bootstrap should add the supported activation without replacing unrelated options. Let the product adapter report startup, flush, shutdown, and connection failures distinctly.

Follow correlation across the actual path. HTTP headers, async context, and queue metadata can each lose correlation. A producer send is not proof of consumer completion. Do not attach work to an execution merely because it happened nearby in time, used the same user ID, or came from a service in the same Compose project.

Separate setup traffic from product traffic. A fixture insert or readiness request must not satisfy an assertion about the application action. Do not relabel effects to fit a desired interpretation. Use the producer’s recorded origin and binding semantics.

## Probe only with task authority

When live validation is requested, identify a safe local operation that should create a distinctive observation. Record the exact system, execution, and activity identity returned by the installed product. Inspect the evidence produced for that operation rather than any collector traffic left over from earlier runs.

If an expected effect is absent, classify what is known: unsupported runtime or library, wrong process startup, bootstrap failure, collector reachability, propagation loss, delivery timing, projection incompatibility, wrong execution, or unresolved cause. Do not convert “no matching row” into “the application did not perform it.” The capture source may not support that claim.

Use stable producer-provided IDs. Do not repair correlation by matching timestamps across machines; clock order is not causal evidence. Do not claim full coverage from zero reported drops, a stable projection, a successful HTTP response, or one successful probe.

## ODC boundary

ODC is optional Post-Alpha diagnostic work. Do not activate it, add an ODC reference, or require a decision producer as part of Alpha discovery. Disabled, unavailable, or unrequested ODC is non-failing. A future explicit ODC mode will need its own adapter and retained capture receipt; its diagnostic result cannot approve a behavior contract.
