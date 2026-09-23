---
name: discovery
description: Discover an application's topology and observability, author or update its Blackbox Alpha catalog and user-owned Node instrumentation bootstrap, and validate supported setup paths.
---

# Discovery

Use this skill when preparing an existing application repository for Blackbox Alpha, reviewing a setup, or validating the first supported journey. Start with the repository and the user's requested system or subsystem. Inspect before acting. Apply setup edits when they are within the requested task, keep them scoped to that application, and preserve unrelated project conventions.

Alpha has one project-authored topology authority: root `blackbox.config.yaml`. It references ordered ordinary Compose files under `.blackbox/compose/`; those files carry no Blackbox metadata. Alex owns application bootstraps and instrumentation under `.blackbox/instrumentation/`. Blackbox owns activation and routing, generic OTLP intake, execution-scoped endpoints, correlation validation, evidence retention, evaluation, and reports. Capsule and native Playwright use one immutable language-neutral execution plan. Node activation and Node/TypeScript Playwright are the supported Alpha runtime path.

Follow the workflow in this order, adapting it to the task:

1. Read the requested behavior and inspect the existing repository. Record source-backed topology and unresolved edges before proposing a catalog boundary. See [topology and catalog](references/topology-and-catalog.md).
2. Map required claims to application-owned instrumentation and Blackbox observation boundaries. Do not treat a configured participant or a healthy endpoint as proof of capture. See [runtime observation](references/runtime-observation.md).
3. Validate the authored setup with the installed, supported catalog capability. Only run the application when the user’s task authorizes a live probe. Distinguish “catalog authored,” “catalog validated,” “runtime exercised,” and “observation established.”
4. If the task includes an experiment or repeatable test, load only the relevant [Capsule](references/capsule-experiments.md), [Playwright](references/playwright-and-authoring.md), or [async workflow](references/async-workflows.md) guidance.
5. For results, baselines, repair, and CI, read [effects and baselines](references/effects-and-baselines.md), [evidence and reports](references/evidence-and-reports.md), [troubleshooting and repair](references/troubleshooting-and-repair.md), or [CI](references/ci.md) only when needed.

The accepted catalog inspection commands are `blackbox catalog validate` and `blackbox catalog list --json`. Exact run selectors are required for `blackbox effects baseline update --run <run-id>` and `blackbox report --run <run-id>`. These names do not prove a command exists in the current installation. Inspect the local package and public help before execution; if the capability is missing, stop at the last supported step and report the gap. Do not infer or invent unsettled Capsule arguments, output envelopes, installation destinations, or retry behavior from historical proposals. There is no Alpha init or catalog-generation command.

The `discovery` skill itself is portable: copy this entire directory into a skill location supported by the host so its references stay with it. This packaging instruction does not claim that `blackbox skill install discovery` is implemented or determine its destination or update behavior.

Do not route to ODC or deferred future-product skills by default. ODC is optional Post-Alpha work; disabled, unavailable, or unrequested ODC does not fail Alpha setup, execution, evidence, or reports.
