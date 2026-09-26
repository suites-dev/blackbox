<!--
PR title MUST be Conventional Commits prefixed (enforced by the "PR Title" check):
  feat(core): add catalog glob matcher
  fix(runners/playwright): preserve execution ID in native runs
Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
-->

## Summary

<!-- What does this PR change and why? -->

## Scope and links

- Closes #N (exactly one implementation Task or Bug issue)
- Parent milestone: #N (link separately; do not close)
- Desired implementation branch: `agent/<stream>/<issue>-<slug>`
- Actual publication/source branch:
- Target base: `main` for development, or the active `release/**` branch for stabilization. Alpha phases 0–6 still use `release/v0.0.1-alpha`; see `maintainers/docs/releasing.md`.
- Delivery phase: `0 Contract`–`6 Release` or `Post-Alpha`
- Product milestone: `Alpha 1`, `Alpha 2`, `Alpha 3`, or `Post-Alpha`
- Testing bundle(s):

<!-- Keep this PR to the linked issue and parent milestone. Do not mix milestones or unrelated cleanup. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Docs / tooling only

## Checklist

- [ ] Commits follow Conventional Commits (enforced by commitlint)
- [ ] The linked Task or Bug issue is the only implementation scope in this PR
- [ ] The PR targets the base required by its delivery phase and owning Project item; no direct push was made to that branch
- [ ] The commands below match the issue contract or the departure is documented

## Validation and evidence

| Command                  | Result                                   |
| ------------------------ | ---------------------------------------- |
| `<!-- exact command -->` | `<!-- pass/fail and relevant output -->` |

- Artifact or receipt locations (paths or URLs):
- Known limitations or failures:
- Departures from the issue contract:

## Security impact

- Trust boundaries affected (listeners, outbound connections, processes, containers, files, telemetry), or `none`:
- Negative tests and results:
- Dependency/security findings and disposition:
- [ ] No secrets or private traces are included in code, logs, or artifacts
- [ ] Security requirements in `SECURITY.md` were checked for affected boundaries
- [ ] CI, E2E, security gates, and an independent code-owner review are required before merge

## Independent review evidence

- Completed GitHub Codex review link:
- Reviewed head SHA:
- `@codex review` PR comment link and result (a request alone or `connect-account` is not a completed review):

<!-- Request reviews only through @codex review on this GitHub PR. Do not spawn review subagents or use separate local/Cloud review tasks. Review evidence must match the exact head SHA. A failed @codex request does not authorize readiness, merge, or promotion. Preserve a native Cloud task-associated PR: do not replace it or create a duplicate. If publication used a codex/* branch or targeted the task input branch, record the actual branch/tooling departure and the coordinator's retargeting/reconciliation before readiness; this is not automatic proof of compliance. -->

## Notes for reviewers

<!-- Anything reviewers should pay special attention to. -->
