# Availability and command map

Source audit: **6 October 2026**. This page records the revisions used to write these docs; it is not a live release-status dashboard.

## Documentation baseline

| Surface | Audited source | Meaning |
| --- | --- | --- |
| Capsule, Catalog, CLI, Skills, Node instrumentation, native Playwright | PR #159 starting at `9197de5` | Implemented in that source snapshot; npm publication is not implied |
| Gherkin compiler, closed vocabulary, project config, compile/check commands | PR #131 at `f52ef2a` | Incoming private preview, not part of #159's original runtime tree |
| Strict verdicts and runner-policy baseline | PR #155 at `404f29c` | Incoming reporter options |
| Gherkin run verification | PR #165 at `88a7374` | Incoming integration of compiler and reporter guardrails |
| Onboarding command, spec drafting facade, Blackbox Spec Kit extension, packaged Action | Agreed product interface | Design contract; no implementation was established in this audit |

Sources: [native Playwright](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md), [Gherkin core](https://github.com/suites-dev/blackbox/pull/131), [reporter guardrails](https://github.com/suites-dev/blackbox/pull/155), [Gherkin verification](https://github.com/suites-dev/blackbox/pull/165).

## Product vocabulary and preview commands

The introductory workflow uses the proposed user-facing verbs. They are not aliases until the installed CLI implements them.

| Proposed interface | Source-preview operation |
| --- | --- |
| `blackbox onboarding start` | Agent performs the [source setup](getting-started/installation.md) and skill installation |
| `blackbox spec draft --file requirement.md` | Agent drafts a Feature from accepted requirements; no audited terminal command |
| `blackbox feature validate --file feature.feature` | `blackbox feature compile --config blackbox.feature.yaml` validates while compiling; no audited validate-only equivalent |
| `blackbox feature suite emit --file feature.feature` | `blackbox feature compile --config blackbox.feature.yaml` |
| `blackbox feature suite check` | No exact alias. `feature check` checks project restrictions; incoming `feature verify` checks compiled/run consistency after execution |
| Spec-to-Feature semantic review | Review and traceability, not a demonstrated deterministic CLI verifier |

Always use `blackbox --help` and the selected command's `--help` for the installed composition. Do not keep trying speculative spellings until one returns success.

## What is not interchangeable

`feature compile` emits tests and a compile manifest. It does not run the system. `feature check` audits project restrictions; it is not the generated-suite drift check. Incoming `feature verify` evaluates a finished run against the compile manifest and the protected runner policy. `playwright test --list` discovers tests; it does not execute them.

A generated suite is derived output, not an alternative authority over its Feature. The Gherkin preview expects its output directory to be ignored by Git and rejects tracked generated tests.

## Effects and reports

The baseline Playwright effects handle is not a completed effect projector. PR #123 develops that layer separately. The Gherkin v1 vocabulary audited here rejects effects claims and participant SQL steps when the required capability is unavailable. Use response and explicit state assertions; do not imply that a diagram or a successful telemetry capture supplies a missing evaluator.

Capsule reports and native Playwright reports are different surfaces. Historical concept illustrations may show interpretation or evaluation layers; captions identify those concepts. There is no audited Capsule checkpoint, automatic effect-baseline, or ODC coverage command.

## Updating this page

When an interface lands, check its registry, help, tests, and package export. Move it to the implemented column only after the actual source supports that move. Keep the source SHA used by examples and screenshots so later interface changes can be traced.

---

[Documentation](README.md)
