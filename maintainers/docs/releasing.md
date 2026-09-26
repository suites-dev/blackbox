# Branches and releases

Blackbox uses a release-branch flow with pnpm workspaces. Lerna fixed versioning is
the planned release mechanism; this policy commit does not install or configure it.
`main` integrates development; only reviewed commits on `release/**` are release
candidates. There is no separate `develop` branch.

| Branch                                                        | Purpose                                       | PR target                                          |
| ------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `feat/*`, `fix/*`, `chore/*`, `agent/<stream>/<issue>-<slug>` | Focused development                           | `main`                                             |
| `release/<version-or-line>`                                   | Stabilization and supported fixes             | Release PRs target this branch                     |
| `prepare-release/<version>`                                   | Lerna version/changelog changes               | The matching `release/**` branch                   |
| `hotfix/<issue>`                                              | Urgent fix branched from the affected release | Affected `release/**`, then forward-port to `main` |

The existing alpha delivery phases 0–6 continue targeting
`release/v0.0.1-alpha`, currently the GitHub default branch. New development uses
`main`. Reconcile the alpha branch into `main` through a reviewed merge PR before
changing the GitHub default; this setup does not reset or replace either history.

## Prepare a release

1. Cut `release/<version-or-line>` from a green, reviewed `main` commit. For the
   current alpha, use the existing release branch. Freeze features on that branch.
2. Branch `prepare-release/<version>` from it. Install with
   `pnpm install --frozen-lockfile`. Before the first version preparation, land a
   separate reviewed PR installing a compatible, vulnerability-checked Lerna version
   and configuring fixed versions in `lerna.json` with `npmClient: "pnpm"`.
   pnpm remains responsible for installing dependencies and running builds.
3. Update the fixed version with Lerna, leaving the changes uncommitted and untagged
   for review. For the first alpha:

   ```sh
   pnpm exec lerna version 0.0.1-alpha.0 --force-publish --no-git-tag-version --no-push --yes
   pnpm install --lockfile-only --ignore-scripts
   ```

   Later versions can use Lerna's conventional version recommendation or an explicit
   reviewed SemVer. Use `--preid alpha` with `prerelease` for subsequent alphas.
   Never version on each feature PR. A version/changelog change is its own release PR.

4. Review all package versions, workspace references, lockfile changes, and generated
   changelogs. Commit with a verified signature and open a PR to the release branch.
   All required checks and independent owner review apply to this PR too.
5. After merge, use a clean checkout of the exact release commit. Re-run validation
   and verify the commit's CodeQL and security results. Review release notes and
   outstanding advisories. Do not release with unresolved confirmed vulnerabilities.

The future Lerna configuration must allow version preparation only on `release/**`
and `prepare-release/**`, with automatic pushing disabled. PRs, not release tooling,
change protected branches. These Lerna restrictions are policy until that setup PR
lands; the GitHub branch protections are enforced independently.

## Tag and publish

All workspace packages are currently `private: true`. No npm publishing workflow is
enabled. This is an intentional release-readiness gate; adding Lerna must not expose
internal packages accidentally.

Before enabling package publication, a reviewed PR must define the public package
set and resolve its complete runtime dependency closure. Check packed tarballs for
Apache license/NOTICE files, needed runtime assets, and absence of secrets, fixtures,
workspace/catalog protocols, or unpublished internal dependencies. Test installation
of those tarballs in a clean consumer project.

For an approved source release, a maintainer creates a signed, annotated `v<version>`
tag on the validated release commit, then creates the GitHub release from that tag.
Mark alpha/beta/rc versions as prereleases. The `v*` tag ruleset prevents tag updates
and deletion. Tag creation is still a maintainer operation; tag rules do not prove
that a tag points to an approved release branch.

Future npm publication must run in a dedicated workflow with a reviewer-protected
`npm` environment, no self-approval, exact release-commit verification, and npm
trusted publishing (OIDC) plus provenance. Do not add a long-lived npm token or
publish from a PR. Restrict deployment to the release source and use `next` for
prereleases, `latest` for stable releases. Configure trusted publishing separately
for each public package before enabling this workflow.

Merge the release history back into `main` through a PR after publication. Squash
feature/fix PRs; retain a merge commit when reconciling branches so Lerna can see
release ancestry and tags. Forward-port hotfixes promptly. Never move an existing
release tag or overwrite a published version; ship a new patch instead.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for validation and
[security operations](security.md) for branch protection and scanner maintenance.
