# Troubleshoot setup and make bounded repairs

Use this reference when catalog validation, acquisition, readiness, observation, a report, or a test fails. Establish which stage failed before drawing conclusions about application behavior.

## Locate the first established failure

Collect the exact repository, installed Blackbox and Playwright versions, selected catalog ID, exact execution/Capsule/run and Activity/attempt IDs, public command used, and a concise sanitized error location. Check whether owned resources are still active. Do not print environment secrets, tokens, or raw customer payloads.

Classify the earliest supported failure:

| Stage              | Inspect                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Capability lookup  | Installed package, public exports, local binary, version, and public help                                          |
| Catalog resolution | Root YAML schema/version, path references, ordered Compose files, service IDs, readiness and activation references |
| Acquisition        | Selected catalog entry, Compose closure, network, image/build, and owned resource state                            |
| Readiness          | Declared participant, container-side port/path, startup logs, and required dependencies                            |
| Runtime activation | Alex-owned tracked bootstrap path, supported version, process startup order, and reported lifecycle outcome        |
| Telemetry delivery | Execution-scoped OTLP route, participant reachability, generic intake, and shutdown/flush results                  |
| Correlation        | Participant and exact execution/activity/attempt binding across the observed path                                  |
| Evaluation         | Selected scope, actual evidence availability, baseline identity, installed schema, and evaluator result            |
| Report projection  | Exact source ID, supported version, unresolved references, and output location                                     |

A service registration or command parser does not prove the workflow worked. A report that now renders may still show an application violation. Keep setup error, capture gap, runner outcome, and behavioral counterexample distinct.

## Preserve evidence and repair the failing layer

Inspect first and retain the original failing identity and artifacts. If the defect is a missing CLI or unresolved contract, report the available capability and hand off. Do not replace a missing public import with a private workspace path or invent an install/repair command.

If a code or configuration repair is part of the requested work, state one testable hypothesis and change the narrowest relevant files. Do not use an implementation repair to hide an evidence problem. Do not silently remove an assertion, observation boundary, selected test, project, or case to get a green run. A changed acceptance target or baseline is a distinct product change; handle it only if included in the user's task.

Repeat the smallest probe that can test the hypothesis, then rerun the original requested scope when feasible. Record exact commands, file edits, fresh execution and attempt IDs, outcomes, and remaining uncertainty. A focused subset pass is not proof that the full selected journey passed. Preserve every retry.

Stop when the required capability or evidence is unavailable, the same failure repeats without a new hypothesis, the bounded execution budget is exhausted, or the next step would change an accepted expectation outside the task. Report the last supported state and the minimum blocker. If a known Capsule cannot stop, retain its exact identity and cleanup error; only act on resources owned by this task.

## Report actionable findings

Lead with the failure stage and the evidence that places it there. Separate established facts from hypotheses. State what claim cannot currently be answered and what exact next observation or owner could unblock it. Do not blame application logic for a harness failure or blame instrumentation for a qualified behavioral counterexample.
