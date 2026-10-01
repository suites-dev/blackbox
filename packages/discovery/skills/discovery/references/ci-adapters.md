# CI/CD inspection and attachment recipes

CI often records a runnable procedure, but it is a source to inspect rather than
a command to execute. Record provider, selected job/matrix, working directory,
runner image, service resources, setup/reset, credentials references, artifacts
and failure-safe cleanup. These recipes do not call provider APIs automatically.

| Provider        | Inspect                                                                                                      | Follow with permission                                               | Attachment constraints                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions  | `.github/workflows/*.yml`, local composite actions, jobs/services, needs, strategy/matrix, env, defaults/run | `uses: owner/repo/...@ref`, reusable workflows, organization runners | Separate job permissions and job-owned services; artifact and exact-Capsule cleanup after failure; do not trigger deployment jobs. |
| GitLab CI       | `.gitlab-ci.yml`, services, stages/needs, extends, variables, rules, before/after scripts                    | include project/remote/component, child pipelines                    | Resolve the selected pipeline context; after_script and artifact behavior must not hide the test result.                           |
| CircleCI        | `.circleci/config.yml`, executors, docker services, workflows, contexts, workspace persistence               | Orbs and remote config processing                                    | Config expansion may fetch sources. Do not infer secret values from context names or reuse writable state across attempts.         |
| Buildkite       | `.buildkite/pipeline.yml`, commands, plugins, agents, depends_on, hooks                                      | Dynamic uploaded pipelines and plugin repositories                   | Pipeline upload mutates remote CI. Agent hooks/plugins execute code; they are not metadata-only inspectors.                        |
| Jenkins         | Jenkinsfile, agents, environment, stages, post/always, Docker agents                                         | Shared libraries and credential references                           | Groovy evaluation executes code. Static extraction may be incomplete; do not run a controller job for discovery.                   |
| Azure Pipelines | azure-pipelines.yml, pools, stages/jobs/steps, services, resources, conditions                               | Template repositories, variable groups, service connections          | Read access does not authorize a service connection or deployment; preserve environment checks.                                    |

## Attach the local procedure

When explicitly requested, add a scoped job using the installation's supported
catalog and Capsule commands. Establish prerequisites, validate static config,
start one selected entry, capture its returned ID, apply setup, send one stimulus,
wait for the exact terminal condition, inspect observations and export records.
Release the same Capsule in a cleanup/finally path. Keep the original failing
status even if report export or cleanup also fails.

Record all physical attempts separately, including retries. Use fresh state or an
explicit tested reset and unique namespace. Environment isolation is not implied
by having a separate runner process. Do not broaden token scopes, publish images,
change production credentials or edit unrelated workflow gates.

Provider syntax and permissions must be confirmed against the installed/provider
version and actual repository definitions. A proposed attachment is not proof of
CI execution. Include missing credentials, unavailable Docker and unsupported
runner capabilities as blockers in the audit.

Sources: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[GitLab YAML](https://docs.gitlab.com/ci/yaml/),
[CircleCI configuration](https://circleci.com/docs/configuration-reference/),
[Buildkite pipelines](https://buildkite.com/docs/pipelines),
[Jenkins pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/),
[Azure YAML schema](https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/).
