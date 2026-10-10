---
name: blackbox-preflight
description: Validate static setup and capabilities without claiming that the application has run.
---

# Static preflight

Read [Compose commands](../../references/docker-compose.md),
[permissions](../../references/permissions.md) and
[capabilities](../../references/capabilities.md).

## Procedure

1. Resolve trusted installed CLI/tool versions and actual help. A reserved command
   or an accepted argument parser does not establish implemented capability.
2. Validate catalog shape, references, selected entry and semantic constraints
   using `blackbox catalog validate --json` where implemented.
3. Check referenced file existence/containment, Compose service names and ordered
   overrides, executables, runtime/activation compatibility, variable requirements,
   namespace/reset plan, port mappings and dangerous host access.
4. Distinguish local document parsing from Docker daemon queries. Verify the
   Docker context before a daemon query; it may address a remote host.
5. Do not run build/create/up or repository startup hooks. Inspect raw Compose
   inputs before rendering because includes and environment resolution can read
   additional sources. Avoid output that exposes variable defaults or values.
6. Keep metadata-only and side-effectful checks distinct. Effective environment
   inspection that creates/builds containers belongs to the live phase.

## Return

Use `task.kind: preflight` and no live execution. Static success means the checked
configuration is valid, not that acquisition, readiness, instrumentation or
behavior works. Return exact blockers and the proposed live probe. Do not invent
`setup check` or `capsule test` commands. <!-- skill-lint: not-available -->
