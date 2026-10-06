# Report captures

Use screenshots from real retained HTML reports. A diagram, synthetic dashboard, or manually assembled pass summary is not a report capture.

## Capture status

| Surface | Source available | Publication status |
| --- | --- | --- |
| Capsule overview and Alice request trace | Retained HTML recovered and rendered locally | Repository image embedding pending |
| Native Playwright HTML report | Inspected artifact has JSON, logs, JUnit, and attachments, but no HTML | A real HTML artifact and capture are still needed |

The documentation currently links the source run and this record rather than embedding a missing or reconstructed image. No PNG is claimed to be committed in this directory.

## Capsule source

[Source CI run](https://github.com/suites-dev/blackbox/actions/runs/37491624257): `37491624257`, attempt 1, E2E workflow. The runtime revision is `d6a04cd8d3ca7e593db7fed72ff05a8158eb00d6`, not the documentation branch.

| Field | Value |
| --- | --- |
| Artifact | `ci-evidence-37491624257-1-demo-capsule` |
| Artifact ID | `11426136392` |
| Artifact SHA-256 | `25efa80d4b6902d4af0f1d48f3c8cd62ec339fb77d2f4878fcc29e75b1f03bec` |
| Lane command | `pnpm test:demo` |
| Capsule | `gentle-workshop-jacob-621797955463` |
| HTML within extracted evidence | `e2e/.blackbox/reports/capsule-gentle-workshop-jacob-621797955463/capsule-report.html` |
| HTML SHA-256 | `989d73a2d1c646fcd23f2879867ebbfac104b4a2dc0bcee732a2ef4d27919126` |

The retained report shows a stopped Subscription system demo and recorded activities. Opening **Create Alice subscription**, then its **POST /subscriptions** observation, exposes the request's runtime tree. These are records of that demo; they are not verification results for this documentation change.

## Reproduce the capture

Download the named artifact from the source run while it is retained. Extract its archive and nested `evidence.tar` using a safe archive extractor. Confirm the HTML digest above, then render the unmodified HTML in a local browser.

For the overview, use a 1200-by-850 viewport. For the expanded Alice trace, use 1560 by 950, open the named activity and request observation, and capture the visible evidence tree. Record viewport, selection, scroll position, runtime revision, and source digest with each image. Keep surrounding identity and limitations visible when space permits.

If local-file navigation is unavailable, a browser automation harness can load the exact HTML with `page.setContent(...)`; this is rendering the retained report, not generating substitute data. Inspect any resource dependencies before rendering a downloaded report. Do not grant it access to credentials or external production systems.

Keep an unedited capture. Label any later crop or palette reduction, and retain its relationship to the original. Redact secrets before publication without changing the result. Never add a success marker, remove a relevant failure, or alter an observed count.

The local captures produced during this documentation pass have these SHA-256 digests; uploading different bytes requires a new record:

```text
capsule-report.png
b5e4f664bd8da629c903d20dcea22a1212894af6335fc454388acf7410d2366e

capsule-trace.png
c60d1d5d03f0b2218637ca62bb41379aad8ca65abd8c9d806dc2e05357fe8420
```

## Playwright source gap

Artifact `ci-evidence-37491624257-1-playwright-system-tests`, ID `11425897914`, belongs to the same source run. It contains structured results and retained evidence, but no native HTML report. Its SHA-256 is `b9f6805369c6e658b547aba06732b8e65843d5b1ce7813ec2ce68fe4fb8be0b2`.

A future capture must come from an actual run with the HTML reporter enabled and its output retained. Open that report with `npx playwright show-report`, select the relevant scenario/attempt, and preserve its source revision. Do not substitute an illustration of what the reporter might eventually show.

See [Playwright reports](../../playwright/reports.md) and [Capsule reports](../../capsules/reports.md).

---

[Documentation](../../README.md)
