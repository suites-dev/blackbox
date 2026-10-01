# Infrastructure and local-setup recipes

IaC describes intended resources and provisioning relationships. It does not prove
runtime use, behavioral relevance, local availability or Capsule ownership.

| Source             | Extract                                                                                                           | Safe boundary                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker/Compose     | Services, build/image, command, dependencies, profiles, networks, mounts, health, ports, config/secret references | Read inputs and ordered overrides first; use the separate Compose guide.                                                                                                         |
| Terraform/OpenTofu | Modules, resources, references, variables/outputs, provider aliases, state boundaries                             | HCL parsing first. `terraform graph` emits a provisioning graph. init/validate/plan can require plugins, state/backend access or provider execution. Never apply for inspection. |
| Pulumi             | Program inputs, resources, stacks/config references and exported endpoints                                        | Preview executes the program and providers. Do not treat it as parsing. Read source/config before authorizing execution.                                                         |
| CloudFormation/CDK | Resource types, Ref/GetAtt, DependsOn, parameters, exports, conditions                                            | Static templates first. CDK synth executes application code; context lookups and macros/transforms may need remote services.                                                     |
| Kubernetes         | Deployments/StatefulSets, Services, Jobs/CronJobs, probes, ConfigMaps/Secret refs, storage and network policies   | Keep namespaces, selectors and targetPorts distinct. kubectl cluster reads need explicit cluster/environment approval.                                                           |
| Helm/Kustomize     | Chart/templates/values or bases/overlays and patches                                                              | Review before rendering. Remote bases, dependencies, plugins and server-side operations may cross trust boundaries. Never install/apply for discovery.                           |
| Dev Containers     | Build/image, Compose selection, mounts, forwarded ports, lifecycle hooks                                          | Development environment is not automatically a Blackbox acquisition. initializeCommand can execute on the host.                                                                  |
| Tilt/Skaffold      | Build graph, local resources, profiles, manifests, dependency/update rules                                        | Configuration or lifecycle commands can execute code and alter a cluster. Inspect before starting.                                                                               |

## From deployment to local acquisition

Map only the approved behavioral slice. Separate resources that can be acquired
locally, existing resources needing explicit access, substitutions requiring
behavioral approval, and unavailable capabilities. Preserve user-owned Compose
configuration where possible. A cloud database declaration may point to a local
test database; record both identities and the substitution limits.

Treat project names, labels, fixed container names, build tags, bind mounts and
external networks/volumes as ownership evidence. Unique process IDs alone do not
isolate writable databases or queue names. A reduced stack still needs migrations,
fixtures, required DNS/network connections and reset/cleanup support.

Do not copy production secrets, state files or rendered provider output into an
audit. `terraform show -json` can expose sensitive state/plan values. Record
references and sanitized structural facts instead. Source-level "sensitive" labels
are not proof that every tool output is redacted.

Sources: [Terraform graph](https://developer.hashicorp.com/terraform/cli/commands/graph),
[Terraform show](https://developer.hashicorp.com/terraform/cli/commands/show),
[Pulumi preview](https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/),
[Kubernetes probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/),
[Dev Container specification](https://containers.dev/implementors/json_reference/).
