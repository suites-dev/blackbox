---
name: discovery
description: Discover an application's topology and observability, author or update its Blackbox Alpha catalog and user-owned Node instrumentation bootstrap, and validate supported setup paths.
---

# Discovery

Use this skill when preparing an existing application repository for Blackbox Alpha, reviewing a setup, or validating the first supported journey. Start with the repository and the user's requested system or subsystem. Inspect before acting. Apply setup edits when they are within the requested task, keep them scoped to that application, and preserve unrelated project conventions.

Alpha has one project-authored topology authority: root `blackbox.config.yaml`, referencing ordered ordinary Compose files. The application owns its instrumentation bootstrap under `.blackbox/instrumentation/`. Blackbox coordinates activation, execution-scoped OTLP intake, command execution, retention, queries, and reports. The current path is Capsule execution with Node instrumentation. Native Playwright integration, normalized-effect matching, and automated claim qualification are in development; references describing those workflows are design guidance, not available commands.

A Capsule supplies the apparatus. An experiment specifies initial conditions, stimulus, measurements, and checks; a trial executes that procedure. Execution identity defines the evidence scope. Trace correlation adds structure but is not required for evidence admission. Controlled state, isolation, and visible domain identities can support behavioral claims across separate traces; they do not manufacture direct span parentage.

Follow the workflow in this order, adapting it to the task:

1. Read the requested behavior and inspect the existing repository. Record source-backed topology and unresolved edges before proposing a catalog boundary. See [topology and catalog](references/topology-and-catalog.md).
2. Map required claims to application-owned instrumentation and Blackbox observation boundaries. Do not treat a configured participant or a healthy endpoint as proof of capture. See [runtime observation](references/runtime-observation.md).
3. Validate the authored setup with the installed, supported catalog capability. Only run the application when the user’s task authorizes a live probe. Distinguish “catalog authored,” “catalog validated,” “runtime exercised,” and “observation established.”
4. For current experiments, read [Capsule](references/capsule-experiments.md) and, when relevant, [async workflows](references/async-workflows.md). Read [Playwright design guidance](references/playwright-and-authoring.md) only when planning the upcoming integration.
5. For current results, repair, and automation, read [evidence and reports](references/evidence-and-reports.md), [troubleshooting and repair](references/troubleshooting-and-repair.md), or [CI](references/ci.md). [Effects and baselines](references/effects-and-baselines.md) describes planned assurance, not an available evaluator.

The supported inspection commands include `blackbox catalog validate --json`, `blackbox catalog ls --json`, and `blackbox observations --session <session-id> --json`. Use `capsule up`, `capsule run`, `capsule down`, and `capsule report`, `capsule report serve|export` for the current journey. Inspect installed help for exact flags. `setup init` and `effects baseline update` remain reserved stubs. `skill install discovery` is available when the Skills plugin is installed and accepts agent flags such as `--codex`, `--claude`, and `--cursor`. Do not infer command shapes from historical proposals.

The `discovery` skill itself is portable: copy this entire directory into a skill location supported by the host so its references stay with it. The command installs this directory into the selected agent skill locations and reports conflicts rather than overwriting authored skills.

ODC/decision coverage, generated Gherkin/specs, suite generation, and legacy contract-promotion surfaces are outside the current product direction. Do not introduce them as setup requirements or promised follow-up capabilities.
