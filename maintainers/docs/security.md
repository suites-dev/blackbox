# Operate the security gates

GitHub CodeQL and repository protections are active. Additional automatic PR
workflows are prepared on the implementation branch and must be published before
they can run. This commit on `main` contains policy documents only. Contributors
will not need local scanner commands or provider credentials.
[SECURITY.md](../../SECURITY.md) defines the engineering requirements and private
reporting route. The table below describes the checks once their setup is published.

## Checks and enforcement

| Control                                        | Runs where                                                                          | Blocks on                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub CodeQL, extended query suite            | GitHub-managed default setup; protected/default branches, PRs to them, weekly scans | Medium-or-higher security alerts and errors through the code-scanning ruleset                  |
| Dependency audit                               | Every PR; pushes to `main`/`release/**`; daily on the default branch                | Any known advisory in workspace or `e2e/sut` lockfiles, including development dependencies     |
| GitHub dependency review                       | Every PR                                                                            | Newly introduced vulnerable dependencies, low severity and above                               |
| Semgrep community engine with repository rules | Every PR; protected-branch pushes; daily                                            | Explicit wildcard listeners, shell execution patterns, disabled TLS checks, dynamic evaluation |
| Gitleaks                                       | Every PR; protected-branch pushes; daily                                            | Secrets in reachable Git history; output is redacted                                           |
| GitHub secret push protection                  | Pushes                                                                              | Supported credential patterns before they enter the repository                                 |
| Snyk Code and Snyk Open Source                 | Native GitHub integration after enrollment below                                    | Source-code vulnerabilities and dependency vulnerabilities                                     |

Snyk is selected but is not connected yet. Do not describe it as active until its
checks have run on a real PR. GitHub CodeQL is already configured with extended
queries and the remote-and-local threat model. Local-source modeling depends on
language support; the negative tests and targeted Semgrep rules remain necessary.
Pattern-based rules cannot prove that dynamic hosts, authorization, or sanitization
are safe. Review those paths and their runtime tests explicitly.

The `Security Gate` job fails if an applicable scanner fails, is cancelled, or is
unexpectedly skipped. CodeQL has a separate native ruleset gate; a successful
analysis job does not mean there are no findings. Do not put secrets in PR workflows,
run untrusted PR code with `pull_request_target`, or grant scanners write access
without a concrete need. The title-only `pull_request_target` workflow never checks
out or executes PR code. External Actions use immutable commit pins; Dependabot
proposes updates.

## Connect Snyk's free OSS program

1. A maintainer applies at [Snyk's Secure Developer Program](https://snyk.io/open-source/).
   Confirm eligibility: the project must not have corporate backing. The program
   requires a Snyk link in the README and project website and permission to display
   project branding. Wait for acceptance before claiming sponsorship or unlimited
   scans. The ordinary Free plan has limits and is not the OSS program.
2. In the approved Snyk organization, connect the
   [GitHub Cloud App](https://docs.snyk.io/developer-tools/integrations/scm-integrations/organization-level-integrations/github-cloud-app).
   Grant repository access only to `suites-dev/blackbox`, then import it. Keep
   authorization in Snyk/GitHub; no API token is needed in PR jobs or this repository.
3. Enable **Snyk Code** and **Snyk Open Source**. Import the root pnpm workspace and
   the standalone `e2e/sut/package.json` with its npm lockfile. Include development
   dependencies. Verify that pnpm's workspace and catalog dependencies are resolved
   and all ten packages appear in the dependency coverage, rather than accepting
   a successful scan of only the root manifest. Track both `main` and each supported
   `release/**` branch; do not assume an import follows the GitHub default forever.
4. Enable PR checks for both products on every new PR and update. Set the lowest
   available severity threshold and disable the option to fail only when a fix
   exists. Enable recurring scans and dependency fix PRs, without auto-merge.
5. Run a real PR, including a fork PR, to verify both products report results on the
   latest revision. Record the actual check names and owning GitHub App ID. Add
   them to `required_status_checks` in
   `.github/security/branches.ruleset.json` on the CI setup branch and apply it
   to GitHub. Do not guess context names or use a credential-dependent job that
   silently skips fork contributions.
6. Confirm a failing scan prevents merge and a clean scan passes. Review the full
   baseline before releasing; checking only newly introduced findings does not
   remediate the existing vulnerability backlog. Recheck coverage after adding a
   package, lockfile, release branch, language, or Docker image.

The account-side handoff needs the approved Snyk organization slug and GitHub App
installation. Never send an API token in chat. Add the agreed sponsorship link
after program acceptance; a repository file cannot enroll the project or turn on
Snyk's native PR checks by itself.

## Maintain GitHub protection

The active [branch ruleset](https://github.com/suites-dev/blackbox/rules/24018446)
covers `main`, the default branch, `release/*`, and nested `release/**/*`. It
requires signed commits, one independent code-owner approval, fresh approval after
the latest push, resolved discussions, up-to-date required checks, and CodeQL
findings below the configured threshold. It prevents deletion and force pushes;
there are no standing bypass actors. Existing Code Quality and automatic Copilot
review rules are retained. Owners are `@omermorad` and `@qballer`.

Required Actions checks are `CI Gate`, `Capsule E2E (Testcontainers)`,
`Validate PR title`, and `Security Gate`, bound to the GitHub Actions App. A new
release branch may be created from a reviewed commit; subsequent changes require
PRs. The [tag ruleset](https://github.com/suites-dev/blackbox/rules/24043163) prevents
updates and deletion of `v*` release tags. See [releasing.md](releasing.md).

The desired settings are prepared under `.github/security` on the CI setup branch;
they are excluded from this documents-only commit. Changing those JSON files does
not change GitHub automatically. From a checkout containing that configuration,
after independent review, an administrator applies it and checks the live state:

```sh
gh api repos/suites-dev/blackbox/rulesets/24018446 --method PUT --input .github/security/branches.ruleset.json
gh api repos/suites-dev/blackbox/rulesets/24043163 --method PUT --input .github/security/tags.ruleset.json
gh api repos/suites-dev/blackbox --method PATCH --input .github/security/repository.settings.json
gh api repos/suites-dev/blackbox/code-scanning/default-setup --method PATCH --input .github/security/codeql.settings.json
```

Private vulnerability reporting, Dependabot alerts/security updates, read-only
default workflow tokens, and prevention of Actions approving PRs are enabled.
Repository settings remain administratively editable, so review GitHub's audit
history after any emergency exception. Never leave a temporary bypass in place.

The workflow files must be present in the PR for the new required checks to run.
Scheduled scans and community-health discovery require these files on the default
branch. A `[skip ci]` commit does not satisfy required checks and can leave them
pending; normal protected-branch work must let the gates run.

`main` initially contains no application workspace. The security bootstrap must not
be mistaken for promoting the alpha implementation: package CI becomes runnable
there when the application and its test harness are integrated. Keep the full setup
on the active release branch as well, including its local composite actions and
evidence scripts. Do not disable checks to conceal a missing application baseline.

## Handle findings and keep scanners current

The initial workspace audit on 2026-09-26, before adding release tooling, found
55 advisories: 2 low, 20 moderate, and 33 high. This is a baseline observation,
not a fixed current count or a clean bill of health. Required audits intentionally
remain failing until vulnerable dependencies are fixed. Triage runtime dependencies
first, then build/test tooling; do not hide the backlog with an ignore list.

Review scanner and dependency updates weekly. Semgrep and Gitleaks are pinned in
`.github/workflows/security.yml` on the CI setup branch; update Gitleaks's checksum
alongside its version. Semgrep's positive and negative rule fixtures run before
each scan. Verify a new rule catches the unsafe example and accepts the safe one.
Audit provider permissions, owners, supported release branches, and alert coverage
at each release. Treat scanner outages as a blocked check, never a success.

For a suspected leak, rotate the credential first, investigate exposure, and follow
the private incident process. Do not just remove the current line: history and
published artifacts may still contain it. Follow the false-positive review process
in [SECURITY.md](../../SECURITY.md) for a narrow, justified exception.
