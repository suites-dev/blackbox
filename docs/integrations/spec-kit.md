# Blackbox with Spec Kit

Part of [design proposals](../design/README.md). Check [availability](../alpha-status.md) for implemented capabilities.

Spec Kit owns its specifications, planning and implementation workflow. Blackbox supplies runtime
verification of the accepted behavior. The proposed `blackbox-spec-kit` extension remains a thin
handoff, **not a published integration in this alpha**.

## Keep one owner for each artifact

The developer or SDD review process approves intent. The agent derives reviewable scenarios, prepares
the system, and creates generated or native Playwright checks. Selected effects
become an accepted baseline only after deliberate review.

The Feature, TypeScript assertions and effects baseline express one [behavioral contract](../contracts/README.md).
They do not become competing requirements documents, and a failed execution must not automatically
rewrite Spec Kit's `spec.md`.

## Fit into the developer's verification journey

```text
Spec Kit's accepted spec.md
        ↓
Reviewed scenarios → selected real system → optional Capsule experiment
        ↓
Executable assertions + recorded effects for review
        ↓
Review baseline → fresh Playwright verification → report and repair
```

Effect evaluation and records belong to Blackbox. The proposed extension connects
that workflow to Spec Kit; the same review process works from plain Markdown.

## The handoff

![Accepted specifications can lead to native Playwright or optional Gherkin and the same Sandbox/runtime path.](../assets/guides/authoring-paths.svg)

Resolve the accepted source and use the existing system configuration where suitable. A new
specification should not automatically create another infrastructure stack. State assertions stay
in the tests; a separate state YAML is still undecided.

## Resolve the active specification

The previously documented bridge design checks `SPECIFY_FEATURE_DIRECTORY` and otherwise the
`feature_directory` in `.specify/feature.json`, then reads that directory's `spec.md`. Treat this as
a version-dependent integration contract to validate when implementing the extension, not a guess
based on timestamps or an assumed `.specify/specify.md` path. Ambiguous sources require clarification.

## Coexist with the existing BDD ecosystem

The community [Spec Kit BDD extension](https://github.com/RSginer/spec-kit-bdd) can supply reviewed
Gherkin. Reuse accepted scenarios instead of creating a competing Feature. Validate against
Blackbox's actual supported vocabulary and surface unsupported meanings. A generic step-definition
stub does not supply executable Blackbox semantics, and traceability does not establish runtime
correctness.

## Proposed extension lifecycle

A thin extension could contribute skills and hooks for drafting, preparation and verification while
delegating to the real Blackbox CLI. Exact command names and integrations are not shipped here.
Hooks must not silently accept baselines, rewrite specifications or weaken required checks.
CI needs actual test and comparison results, not an agent's assertion that it ran them.

## Without the bridge

Give the agent an explicit accepted spec path and use the [developer workflow](../guides/from-spec-to-verification.md).
Neither Spec Kit nor a new Gherkin file is required for native Playwright. The broader existing-test
adoption workflow is intentionally not specified yet.

[Contract review](../contracts/reviewing-changes.md) · [CI](../guides/ci-verification.md)

## Upstream references

[Spec Kit](https://github.com/github/spec-kit) ·
[Extension development](https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-DEVELOPMENT-GUIDE.md) ·
[Community BDD extension](https://github.com/RSginer/spec-kit-bdd)
