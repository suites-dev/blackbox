# Contributing to Blackbox

Start with a focused issue and a pull request. Report vulnerabilities through
[SECURITY.md](SECURITY.md), never a public bug report.

Blackbox is being built in public and has not been published. The current default
branch is `release/v0.0.1-alpha`. Start with the [current status](docs/alpha-status.md)
and [Capsule source workflow](docs/getting-started.md); Playwright integration is
still in progress.

## Set up and validate

Use Node.js 22.15 or newer in the Node 22 line and pnpm 9.15.4 (the pinned
`packageManager`). Docker is required for Capsule end-to-end tests.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm check:deps
pnpm typecheck
pnpm test
```

`pnpm test` builds the packages first. The Docker-backed acceptance journey needs
more setup: the workspace has to be built, published to a local registry, and
installed into a consumer before `pnpm run test:demo </dev/null` will run. Use a
disposable checkout, because preparation resets generated `e2e/.blackbox/` state and
stops previous sessions. The [acceptance guide](maintainers/docs/capsule-bash-e2e.md)
has the registry commands; read it before running any of this in an existing checkout.

The checked-in [CI](.github/workflows/ci.yml), [E2E](.github/workflows/e2e.yml), and
[security](.github/workflows/security.yml) workflows define the repository lanes.
See [security operations](maintainers/docs/security.md) for provider setup details;
an external provider's status must be verified separately from its configuration.

For package responsibilities and workspace checks, see the [package map](maintainers/docs/packages.md).

## Branch and review

Current alpha work targets `release/v0.0.1-alpha`, including phases 0–6.
`main` remains the development integration branch in the broader release flow;
follow the owning issue and intended PR base when working outside the active alpha.
Keep the owning Project item consistent with this choice.
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
