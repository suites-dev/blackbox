---
name: blackbox-infrastructure
description: Route IaC and deployment evidence into a local acquisition proposal without applying remote infrastructure.
---

# Infrastructure router

Use [IaC recipes](../../references/infrastructure-adapters.md) and the
[Compose command guide](../../references/docker-compose.md).

## Procedure

1. Detect Compose/Dockerfiles, Terraform/OpenTofu, Pulumi, CloudFormation/CDK,
   Kubernetes/Helm/Kustomize, Dev Containers, Tilt and Skaffold.
2. Extract resource declarations, process images/builds, names, protocols,
   service discovery, networks, storage, credentials references, readiness,
   migration jobs and the intended environment/profile.
3. Separate deployed resources from what a local Capsule can acquire. A cloud
   resource may need an approved external connection or a justified emulator.
   Its existence in IaC does not make an acquisition adapter available.
4. Read templates/configuration before invoking tools. Preview, synth, plan,
   initialization and remote rendering can execute code, download modules or
   contact cloud providers. Request permission for those effects separately.
5. Preserve useful local Compose configuration. Translate only a reviewed local
   subset. Do not silently apply Terraform, deploy Helm or start a developer
   environment to inspect it.
6. Verify network isolation, dynamic host ports and cleanup ownership. Treat
   external networks/volumes, shared tags and host mounts as explicit boundaries.

## Return

Emit deployment and prerequisite edges with provenance. Record the local
acquisition proposal and unsupported resources separately from the source topology.
The installed catalog adapter is authoritative; discovery does not add new runtime
capabilities by naming another platform.
