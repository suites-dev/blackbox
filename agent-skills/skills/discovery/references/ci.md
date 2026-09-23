# Use native Playwright in CI

Use this reference when the requested task includes a Blackbox Alpha CI journey or diagnosis of a pipeline run.

Inspect the existing CI provider, repository lockfile, current Node/Playwright versions, selected tests and projects, local dependencies, Docker or Compose access, state reset strategy, secret policy, and existing artifact retention conventions. Keep the runner native to the repository. Alpha's test entrypoint is the project's `npx playwright test` path; do not add a Blackbox suite wrapper.

Keep the CI topology equivalent to the local catalog: one root `blackbox.config.yaml`, ordinary referenced Compose files, Alex-owned Node bootstrap, and the same catalog-resolved plan. Use a job-specific workspace and test data. A hosted runner without the acquisition driver's required container capability cannot establish the live journey; record that limitation rather than treating a skipped integration as a pass.

Retain exact run, execution, attempt, and artifact-root identities for every job or shard. Preserve the original planned scope, retries, and per-attempt evidence so a passing retry does not hide an earlier failure. Keep native runner status, runtime evaluation, capture limitations, report generation, and cleanup results separate.

Run report projection and artifact upload through the CI provider's failure-safe mechanism so a failing test does not erase its evidence. Record native test status, report generation, required-evidence generation, upload, and cleanup separately. For Alpha acceptance lanes, retain JUnit, coverage, and a reproducible receipt with exact run/execution IDs, artifact roots, versions, commands, and results. If any required artifact is missing, invalid, or unuploaded, fail the evidence gate even when native tests return zero. Gate HTML report creation too when the lane requires it. A generated HTML report is useful for reading; it is not behavioral acceptance. Optional, disabled, or unavailable ODC does not fail the Alpha gate.

Clean up only resources created by the current job, after retaining evidence. Record cleanup failures and fail the job when required cleanup or evidence-retention gates are not satisfied. Never globally prune a shared runner's containers, volumes, or artifacts.

Do not change workflows, branch protections, required checks, artifact-sharing policy, or publication behavior unless the user requested that CI change. Report workflow files edited, exact invocation and selected scope, retained artifacts, separate outcomes, and any steps that remain unexecuted. A proposed YAML example is not a validated pipeline.
