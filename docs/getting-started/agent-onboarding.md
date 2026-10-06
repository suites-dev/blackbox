# Agent onboarding

Open your coding agent in the project. Give it the setup task below rather than manually selecting every Blackbox package.

**Interface status:** `onboarding start` is the target entry point. Until the installed version exposes it, the agent follows [source installation](installation.md) and the available skills. See the [command map](../status.md).

```txt
Set up Suites Blackbox for this repository using its CLI and skills.
Start with npx @suites/blackbox-cli onboarding start when available;
otherwise use the documented source-preview setup.

Read the existing requirements and choose the smallest useful system.
Configure Blackbox, run one focused check, and show me its HTML report.
Use the requirements as the expected behavior. Ask before changing them.
Report missing capabilities, permissions, or secrets instead of guessing.
```

## What the agent does

The agent first inspects the repository: how services start, which dependencies are required, where entrypoints and readiness checks live, and what the existing tests already establish. It records unknowns instead of treating a dependency graph as runtime proof.

It then chooses a catalog entry for the initial question, installs compatible execution support, and prepares any project-owned drivers and Node instrumentation. It validates the catalog before acquiring resources. The default composition supplies the entry, Discovery, and Catalog skills; Capsule is selected separately when live investigation is needed.

Finally it starts the selected system, establishes initial state, performs one action, checks the intended result, inspects observation availability, and stops the resources it owns. A health check establishes reachability, not the correctness of an entire feature.

## Review the setup result

The handoff should name the selected system and excluded dependencies, the files changed, exact session or attempt IDs, the check performed, the report location, and the cleanup result. It should also say which runtime boundaries were observed and which remain unavailable.

A useful setup result is: “The payment subsystem starts; the health request returned 200; Node HTTP capture was available; these resources were released.” It is not: “Everything is verified.”

## Existing Spec Kit projects

The agent can recognize a Spec Kit workspace and use [blackbox-spec-kit](../integrations/spec-kit.md) as the handoff. This is optional. Do not initialize Spec Kit merely to make Blackbox work, overwrite its specification, or run two competing scenario generators over the same files.

## When setup stops

Missing package publication, a stopped Docker engine, missing credentials, an unsupported runtime, or an unapproved external dependency are actionable setup findings. Preserve the partial result. Do not relax readiness or observation requirements just to obtain a green setup command.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/README.md). [Capsule procedure](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/skills/capsule/SKILL.md).

---

[Documentation](../README.md)
