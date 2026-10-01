# Run Capsule investigations in CI

Use this reference when automating the current Capsule workflow or diagnosing its CI result. Native Playwright
provides per-attempt Sandbox, telemetry, and effects-contract fixtures. Effect projection and automated claim
qualification remain later assurance stages, so Capsule remains the working path for direct effect investigation.

Use the same root catalog, ordinary Compose files, Node instrumentation, and project drivers as local execution.
Provide Docker access, a job-owned workspace, known fixture data, and the installed CLI. Validate configuration,
start the selected system, retain the returned session identity, perform the setup and stimulus, inspect the required
evidence, export the report, and stop that exact Capsule even if the stimulus or a check fails.

Keep command exit, application response/state, received observations, report export, artifact upload, and cleanup
outcomes separate. Retain JSON command results and the HTML/JSON report with the job's revision and exact commands.
A successful artifact upload or command exit does not establish every business claim. An early empty query does not
establish absence; bound waits around the particular completion signal and required evidence.

Clean up only resources owned by the job. Do not globally prune containers or reuse another job's evidence.
Change workflow gates, credentials, publication, or branch protections only within the requested task.

For native Playwright runs, preserve scheduling and every physical attempt's identity and evidence, including
retries, skips, interruptions, and missing shards. Fresh state belongs to each attempt. Effects qualification and
baseline evaluation are a separate later layer. ODC and generated feature/spec workflows are outside product scope.
