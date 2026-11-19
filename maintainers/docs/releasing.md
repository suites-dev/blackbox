# Release Blackbox

Blackbox publishes one fixed public package version per release. Alpha versions such as
`0.0.1-alpha.0` use the npm `alpha` dist-tag, other prereleases use `next`, and stable versions
use `latest`. The [channel selector](../../.github/scripts/release-channel.sh) also marks both
prerelease channels as prereleases on GitHub.

| Work                                                 | Pull request base                                             |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Development outside the active alpha                 | `main`                                                        |
| Alpha phases 0–6                                     | `release/v0.0.1-alpha`                                        |
| Release preparation from `prepare-release/<version>` | The matching release branch, currently `release/v0.0.1-alpha` |
| Final alpha promotion from `release/v0.0.1-alpha`    | `main`                                                        |

The active alpha branch is currently the default. After the first final release PR lands, a
repository owner can authorize making `main` the default before starting the next release line.
Start later release lines from the previous published tag on `main`.

## Verify the package inventory

Run `pnpm exec lerna list --all --json` after a frozen install. Compare it with the
[public package inventory](packages.md#public-package-inventory) and
[`lerna.json`](../../lerna.json). The 17 public packages share the declared release version
and publish with public access and provenance. The private
[`@suites/blackbox-e2e-harness`](../../e2e/package.json) is a workspace fixture at `0.0.0`.
The root workspace manifest is also private. Lerna excludes private packages from publication.

## Prepare and promote a candidate

1. Squash reviewed alpha work into `release/v0.0.1-alpha`. Protected branches accept squash
   merges. Use Conventional Commit PR titles because GitHub uses the title as the squash
   commit subject and Lerna uses those subjects for version recommendations and changelogs.
2. Run [Release Preview](../../.github/workflows/release-preview.yml) on the exact release
   branch. Choose `prerelease` for the next `alpha` version or `stable` for graduation.
   Check the source commit, proposed version, and diff in the job summary. The dispatch uses
   a frozen install and keeps version and changelog changes local to its runner.
3. Check the proposed version against the fixed workspace version, existing remote release
   tags, and npm versions for every public package. Choose an unused candidate.
4. Create `prepare-release/<version>` from the exact release-branch commit. Confirm
   `lerna.json` permits the preparation branch and sets `push: false`. Set
   `release_version` in the shell to the approved version, then run:

   ```sh
   pnpm install --frozen-lockfile &&
     pnpm exec lerna version "${release_version:?Set the approved release version}" \
       --force-publish \
       --no-private \
       --no-git-tag-version \
       --no-push \
       --yes &&
     pnpm install --lockfile-only --ignore-scripts
   ```

5. Inspect package versions, dependency ranges, changelogs, and the lockfile diff. Confirm
   the E2E harness remains private, then collect local evidence.

   ```sh
   pnpm install --frozen-lockfile
   pnpm exec lerna list --all --json
   pnpm lint
   pnpm check:deps
   pnpm typecheck
   pnpm test
   pnpm test:integration
   ```

6. Open the preparation PR against the matching release branch and verify the merge gates
   below. Once the authorized squash merge lands, open the final release PR from that branch
   to `main` with title `chore(release): <version>`. Compare its proposed merge tree with
   the reviewed release candidate and run the same gates on the final PR. Record the resulting
   squash commit SHA after the authorized merge. That exact `main` commit is the tag target.

### Verify the merge gates on both PRs

- Confirm the PR head, base, and tested tree. Require `CI Gate`, `E2E Gate`, `Security Gate`,
  and `Validate PR title` on the current revision. Inspect the underlying jobs and applicable
  code-scanning results. Check the live branch rules for additional gates. A title edit reruns
  the title check. [CI listener](../../.agents/skills/repo-setup/references/ci-listener.md)
- Obtain independent code-owner approval per the repository PR contract. Confirm a completed
  GitHub `@codex review` for the exact head SHA and resolve review conversations. A pending
  review request leaves the gate open. [PR review contract](../../.github/PULL_REQUEST_TEMPLATE.md)

## Verify publishing prerequisites before tagging

Authorization to prepare a release or open a PR does not authorize merging, creating or pushing
a release tag, approving an npm deployment, dispatching or retrying a publish, moving npm
dist-tags, or changing repository protection. Obtain explicit authorization for those actions.

1. Verify the npm owner can publish each public package under `@suites`. For each package,
   configure a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for repository
   `suites-dev/blackbox`, workflow `publish-release.yml`, and environment `npm`. Enable direct
   publishing for this workflow.
2. If a new package needs owner-side bootstrapping before npm permits the trusted publisher
   configuration, obtain separate authorization and resolve that before tagging. The workflow
   relies on OIDC with provenance.
3. Verify the live `npm` environment accepts `v*` tags, requires an independent reviewer,
   prevents self-review, and disallows administrator bypass. Verify live branch and tag rules
   on `main`, the release branch, and the `v*` tag pattern. The tag rules prevent updates and
   deletion. [Repository rulesets](https://github.com/suites-dev/blackbox/rulesets)

## Tag the reviewed commit and verify publication

Once tagging and publication are authorized, set `release_version` and the recorded
`release_commit` in the shell. Verify the commit and create a signed, annotated tag on it.

```sh
release_tag="v${release_version:?Set the approved release version}"
git fetch origin main &&
  git merge-base --is-ancestor "${release_commit:?Set the final squash commit}" origin/main &&
  git tag --sign --message "Blackbox $release_tag" "$release_tag" "$release_commit" &&
  git push origin "refs/tags/$release_tag"
```

The tag push starts [Publish Release](../../.github/workflows/publish-release.yml).
The verification job checks the tag format, GitHub-verified signature, commit ancestry on
`origin/main`, clean checkout, and public package versions. It uses Node 24 and pnpm 9.15.4
to run the frozen install, lint, dependency-boundary check, typecheck, and package tests.

After verification and `npm` environment approval, the publish job checks out the verified
commit, confirms the tag still points to it, and builds the workspace. Lerna publishes
unpublished public versions through `from-package` using the selected dist-tag, OIDC, and
provenance. The workflow then creates the GitHub Release.

After the run, verify the selected dist-tag points to the candidate version for every public
package and confirm provenance and the GitHub Release. For an authorized retry after partial
publication, dispatch **Publish Release** from the same immutable tag, using that tag for both
the workflow ref and the `release_tag` input. The environment applies its tag policy to the
workflow ref. Lerna skips versions that are already published, so verify their dist-tags
separately if a partial run left any mismatched. Keep the Git tag immutable and obtain
separate authorization for any npm dist-tag correction.

For a hotfix, cut `release/<patch>` from the affected tag and repeat the preparation, promotion,
and publication sequence with a new version. If `main` has advanced incompatibly, reconcile
the candidate before the final review and rerun the gates.
