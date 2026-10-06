# Blackbox with Spec Kit

`blackbox-spec-kit` is the proposed thin extension connecting a Spec Kit feature to Blackbox verification. It does not replace Spec Kit's specification, planning, task, implementation, or convergence workflow.

> **Integration design:** this page specifies the intended handoff. Installation in the community catalog, command registration, and lifecycle hooks were not implemented or verified in the documentation baseline. The Blackbox CLI operations below are separately identified in the [command map](../status.md).

## Ownership

| Artifact or operation | Owner |
| --- | --- |
| Product specification, clarification, plan, tasks | Spec Kit and the project's reviewers |
| Accepted expected behavior | The authoritative requirement and review process |
| Feature draft and source mapping | Agent using the bridge and Blackbox vocabulary |
| Feature validation, generated suite, run consistency | Blackbox |
| System boundary, Capsule, Sandbox, runtime evidence | Blackbox |
| Cross-artifact/code convergence | Spec Kit; Blackbox results can supply runtime findings |

The bridge should not rewrite `spec.md` because a test fails. It returns the failure and evidence so the existing workflow can decide on implementation work or an explicitly reviewed requirement change.

## Resolve the active feature

Resolve `SPECIFY_FEATURE_DIRECTORY` when set. Otherwise read `feature_directory` from `.specify/feature.json`. Read `spec.md` inside that resolved directory. Do not assume `.specify/specify.md` is the active specification or select the newest directory by timestamp.

Load relevant acceptance scenarios and requirements. Use the plan to resolve technical boundaries, not to replace the spec's expected behavior. Unclear intent goes back to clarification.

## Draft one executable artifact

The bridge should delegate drafting to the same Blackbox skill used for ordinary Markdown. Its output is one reviewed Feature in the project's chosen feature directory, not a parallel Blackbox copy of the product specification.

Where Spec Kit already has Gherkin, validate and refine that artifact rather than generating another set blindly. Generic BDD steps do not become executable simply by having a `.feature` extension. Unsupported statements need review and a supported expression; they must not be silently discarded.

The preview compiler accepts `@requirement:REQ-<n>` tags. A Spec Kit source may use `FR-001`, `SC-001`, or a user-story acceptance ID. Preserve the original source ID in an explicit mapping to a stable Blackbox requirement ID. Do not relabel `FR-001` as supported syntax or renumber identities on every run.

## Proposed extension surface

Use an extension namespace rather than introducing a new core Spec Kit verb:

```text
speckit.blackbox.setup
speckit.blackbox.draft
speckit.blackbox.verify
```

These are proposed manifest command IDs, not terminal commands. Their chat invocation depends on the installed agent integration. A host may expose dots, hyphenated skills, or another supported invocation form.

`setup` routes to Blackbox onboarding and Discovery. `draft` resolves the active spec and prepares reviewable scenarios. `verify` delegates to the installed Blackbox CLI and Playwright, then returns identified results rather than inventing a second evaluator.

## Lifecycle integration

After specification or clarification, offer a draft or reconciliation step. Before implementation, validate accepted executable scenarios. After implementation, or before convergence, offer focused runtime verification. Keep expensive full-suite execution in CI rather than launching it after every agent step.

Hooks are workflow conveniences, not enforcement by themselves. A required CI job must invoke deterministic checks and fail on their exit status even if an agent skipped a suggested hook.

The bridge should preserve optional user approval and avoid duplicate hook execution when another BDD extension is installed. It must not fork the implementation loop or take over task ownership.

## Verification handoff

For an installation containing the incoming Gherkin commands, the executable phase is the same as standalone Blackbox:

```sh
blackbox feature check --config blackbox.feature.yaml
blackbox feature compile --config blackbox.feature.yaml
npx playwright test
blackbox feature verify --config blackbox.feature.yaml
```

CI must preserve failure from both the test process and post-run verifier; see the [CI procedure](../playwright/ci.md). The bridge returns paths to the actual compile/run records and reports, plus failed or unresolved claims.

A requirement-to-scenario map establishes traceability. It does not prove semantic completeness. A clean source inspection does not substitute for an execution, and a passing runtime subset does not establish every requirement in the Spec Kit feature.

## Without the extension

Give the agent the exact active `spec.md` path and use [ordinary Markdown drafting](../specifications/from-markdown.md). The selected system, Feature compiler, Playwright runtime, evidence, and reports do not depend on Spec Kit.

## Upstream contracts

[Spec Kit extension development](https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-DEVELOPMENT-GUIDE.md) explains manifest commands and hooks. The [core convergence command](https://github.com/github/spec-kit/blob/main/templates/commands/converge.md) owns assessment against Spec Kit artifacts. The community [BDD extension](https://github.com/RSginer/spec-kit-bdd) is separate from the Blackbox handoff described here.

---

[Documentation](../README.md)
