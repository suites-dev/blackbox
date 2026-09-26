# Contributing to Blackbox

Start with a focused issue and a pull request. Report vulnerabilities through
[SECURITY.md](SECURITY.md), never a public bug report.

## Set up and validate

Use Node.js 22.15 or newer in the Node 22 line and pnpm 9.15.4 (the pinned
`packageManager`). Docker is required for Capsule end-to-end tests.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:capsule
```

`pnpm test` builds the packages first. GitHub CodeQL is active; the additional
automatic PR security workflows must land from the CI setup branch before they
can run. Contributors will not need scanner accounts or local audit commands.
These development commands require the application workspace, which is not part
of the policy-only bootstrap on `main`.
See [security operations](maintainers/docs/security.md) for provider setup status.

## Branch and review

Normal development targets `main`; stabilization and fixes for an active release
target its `release/**` branch. Existing alpha phases 0–6 continue to target
`release/v0.0.1-alpha`. Keep the owning Project item consistent with this choice.
Use a short-lived `feat/...`, `fix/...`, `chore/...`, or the established
`agent/<stream>/<issue>-<slug>` branch. See [the release flow](maintainers/docs/releasing.md).

Use Conventional Commits, including the PR title: `fix(server): reject foreign origins`.
Squash feature and fix PRs; use a merge commit to reconcile release history into
`main`. Cryptographically sign commits (SSH or GPG); `git commit -s` alone is only
a sign-off and does not satisfy GitHub's verified-signature rule.

Every protected-branch change needs approval from a code owner other than its
author, approval after the latest push, resolved review threads, and current green
CI, E2E, title, and security checks. New pushes dismiss stale approvals. Administrators
have no standing bypass. Automated review assists human review; it cannot approve
on a maintainer's behalf. Include the existing GitHub Codex review evidence when
required by the PR's delivery contract.

For changes to listeners, network clients, process execution, containers, file
access, or telemetry, explain the trust boundary and add negative tests against
the [security requirements](SECURITY.md#required-engineering-controls). Changes to
workflows, dependency locks, release tools, and security exceptions require the
same review. Do not approve a dependency update based only on a green version bump.

## License and conduct

Contributions intentionally submitted for inclusion are under [Apache-2.0](LICENSE).
Retain third-party notices and do not copy code without a compatible license.
Follow our [Code of Conduct](CODE_OF_CONDUCT.md). For usage questions, see
[SUPPORT.md](SUPPORT.md).
