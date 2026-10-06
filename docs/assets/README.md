# Documentation assets

The README uses short workflow figures. The detailed documentation can use the supplied technical illustrations. Neither set is a captured execution or evidence that a feature is implemented.

## README figures

| Stem | Purpose |
| --- | --- |
| `readme-spec-workflow` | Specification, reviewed Feature, emitted Playwright suite, isolated execution |
| `readme-machine` | Agent-operated Capsule and Playwright paths |
| `readme-evidence` | Response, explicit state reads, and supported runtime observations |
| `readme-boundaries` | An agent-maintained catalog with selectable system boundaries |

Each stem has four files under `figures/`: `-light.svg`, `-dark.svg`, `-mobile-light.svg`, and `-mobile-dark.svg`. Mobile diagrams have their own layout; they are not scaled-down desktop canvases.

In a `<picture>`, put mobile-dark first, mobile-light second, desktop-dark third, and desktop-light in the fallback `<img>`. Keep the same descriptive alt text across variants. The root README shows this arrangement. The mobile threshold in those references is 600px.

## Supplied technical illustrations

The eleven supplied concepts are retained as light/dark pairs. These are larger reading figures, not extra README sections.

| Stem | Documentation topic |
| --- | --- |
| `01-verification-machine` | [Verification model](../verification/index.md) |
| `02-capsule-experiment` | [Experiments and retained records](../capsules/experiments.md) |
| `03-capsule-anatomy` | [Activities and interpretation](../capsules/activities.md) |
| `04-activity-vs-observation` | [Runtime observations](../verification/runtime-observations.md) |
| `05-one-config-many-suts` | [System boundaries](../systems/system-boundaries.md) |
| `06-playwright-verification` | [Physical attempts and retries](../playwright/execution-and-retries.md) |
| `07-evidence-qualification` | [Evidence qualification](../verification/evidence-qualification.md) |
| `08-agent-skills` | [Agent skills](../agents/skills.md) |
| `09-follow-the-evidence` | [Evidence provenance](../verification/evidence.md) |
| `10-odc` | Experimental concept only; not a published coverage API |
| `11-instrumentation-boundaries` | [Instrumentation](../systems/instrumentation.md) |

These pairs do not have separate mobile versions. On narrow screens, keep the adjacent textual explanation usable and allow readers to open the full illustration. Do not shrink a technical comparison until its labels become unreadable.

## Source and styling

The design inputs are the supplied Suites tokens, globals, component CSS, code theme, and eleven original SVGs. The documentation treatment uses flat backgrounds, restrained borders, brand rose, and technical typography rather than the marketing-page gradients or window decorations.

Dark surfaces use `#0f0f12`, `#17171c`, and `#202027`. Canonical brand anchors remain `#db486f`, `#e67189`, and `#ef9dab`; light-mode text accents use `#c54164`. The SVGs are self-contained: no scripts, remote stylesheets, linked raster images, or embedded font files. Font-family stacks use local viewer fallbacks.

The supplied compositions are preserved, with wording corrections for the documented model: YAML catalog naming, agent-authored notes rather than an invented checkpoint API, and generic skill/inspection labels rather than unimplemented commands.

## Illustration versus implemented contract

Figure 06 includes a historical effects-snapshot/ODC design example. Figure 10 is explicitly experimental. They must not be presented as screenshots, current reporter output, or an implemented public coverage command. Consult [availability](../status.md) before adding a capability claim to a caption.

An arrow between Capsule and Playwright paths denotes shared configuration or a reviewed handoff, not shared live state. Response/state/runtime branches are different evidence sources, not proof of one another. A count of observations is not a behavioral verdict.

The older `01-blackbox-flow` through `06-isolated-sandboxes` files were an earlier design pass. They are not the active figure set used by this README.

## Reports

Actual report captures have a separate [provenance record](screenshots/README.md). Do not redraw a report and present the result as an execution screenshot.

---

[Documentation](../README.md)
