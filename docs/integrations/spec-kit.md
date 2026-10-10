# Blackbox with Spec Kit

Spec Kit provides structured specifications, plans, tasks, and an agentic implementation workflow. Blackbox provides **executable system verification** against the accepted behavior.

The proposed `blackbox-spec-kit` extension is a thin handoff. **It is not published or installed by this alpha**. You can use the same conceptual workflow today by giving the Blackbox agent the accepted `spec.md` path.

## Keep one owner for each artifact

| Artifact or capability | Owner |
| --- | --- |
| `spec.md`, requirements, clarification, planning, tasks | Spec Kit and the project's reviewers |
| Accepted meaning of the requirement | Developer or relevant human approval process |
| Native tests or a reviewed executable Feature | Blackbox authoring path, derived from accepted behavior |
| Sandbox, clients, evidence, runtime diagnostics, test execution | Blackbox |
| Cross-artifact planning/implementation convergence | Spec Kit; Blackbox may contribute runtime findings |

Do not automatically rewrite `spec.md` after a failed runtime check. Fix the implementation when it contradicts accepted behavior, or return a proposed requirement change for explicit review.

## The handoff

```text
             Spec Kit
      clarify / specify / review
                 |
            active spec.md
                 |
        accepted behavioral claims
                 |
                 v
              Blackbox
       /                   \
 Native Playwright     Reviewed Feature
       \                   /
      selected system + Sandbox
                 |
       results + state + effects
                 |
       evidence-led repair loop
```

Both authoring paths use the same runtime. A Feature is optional. Spec Kit is optional as well.

## Resolve the active specification

The bridge should look for `SPECIFY_FEATURE_DIRECTORY` and otherwise use the `feature_directory` recorded by `.specify/feature.json`. Read `spec.md` from that active feature directory. **Do not assume `.specify/specify.md` is current**, and do not guess the current feature based on timestamps.

That is a concrete integration contract, not just a folder convention. The Spec Kit BDD extension once had to correct a read-location bug caused by assuming the wrong spec location.

If the source is absent or ambiguous, surface the problem rather than silently selecting another specification.

## Coexist with the existing BDD ecosystem

The community [Spec Kit BDD extension](https://github.com/RSginer/spec-kit-bdd) can already derive Gherkin acceptance scenarios and map specification requirements to them.

Blackbox should not produce a second competing Gherkin source when one has already been reviewed. It should:

1. Consume the existing accepted scenario or help the agent propose one for review.
2. Validate its steps against **Blackbox's actual executable vocabulary**.
3. Surface unsupported or ambiguous steps rather than silently deleting them.
4. Use the resulting reviewed expectations for native Playwright execution, evidence, and repeatable verification.

A generic Gherkin sentence or step-definition stub is not automatically executable in the Blackbox Feature compiler. Nor does a spec-to-scenario traceability matrix establish that the application behaves correctly.

## Proposed extension lifecycle

A future Spec Kit extension can add skills, agent commands and optional lifecycle hooks to propose a Feature after `specify`, check that expectations are reviewed before implementation, and request runtime verification after implementation/convergence.

For illustration, the command identifiers might be `speckit.blackbox.setup`, `speckit.blackbox.draft`, and `speckit.blackbox.verify`. **These are proposed names, not runnable commands.** The implementation should delegate to the shipped Blackbox CLI instead of duplicating its verification semantics inside an agent prompt.

Agent hooks are not enforcement: CI must invoke the actual selected tests and drift checks, honor their exit status, and retain reports.

## Without the bridge

Give the agent the active Spec Kit `spec.md` path and follow [Connect your application](../playwright/connect-your-application.md). You don't have to install, initialize, or even use Spec Kit for a vanilla Markdown project.

[Spec-Driven Verification](../concepts/spec-driven-verification.md) · [Feature authoring](../features/README.md) · [Runtime evidence](../concepts/behavioral-evidence.md)

## Upstream references

[Spec Kit](https://github.com/github/spec-kit) · [Extension development](https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-DEVELOPMENT-GUIDE.md) · [Community BDD extension](https://github.com/RSginer/spec-kit-bdd)
