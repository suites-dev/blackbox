---
name: blackbox-dependencies
description: Route dependency inspection to language-specific tools and normalize their different graph layers.
---

# Dependency-inspector router

Read [analyzer recipes](../../references/dependency-inspectors.md). Do not install
or execute an analyzer without appropriate permission. Prefer an existing trusted
binary and configuration. Code-based tool configuration can itself execute code.

## Route by the actual workspace

| Ecosystem             | First useful evidence               | Deeper inspection                                               |
| --------------------- | ----------------------------------- | --------------------------------------------------------------- |
| JavaScript/TypeScript | Workspace and lockfiles             | dependency-cruiser JSON, then startup/client configuration      |
| JVM                   | Maven/Gradle metadata, built JARs   | jdeps; WALA or SootUp only for a justified call-graph question  |
| Python                | pyproject/lockfiles, source imports | AST/pydeps for modules; pip inspect for installed distributions |
| Go                    | go.mod/go.work                      | go list JSON for packages; module graph separately              |
| Rust                  | Cargo manifests/lock                | cargo metadata and feature-aware package graph                  |
| .NET                  | Project/solution/assets files       | package-list JSON; Roslyn when source symbols are needed        |
| Ruby                  | Gemfile.lock and require sites      | Bundler inventory; framework routes/jobs and configuration      |

## Normalize, do not flatten

1. Identify the layer supplied: package, source/import, call, deployment, runtime
   service, or external resource. Keep edge `kind` and relation explicit.
2. Map code to a participant using build output and a launch command. An import
   of a Redis library is not a Redis server or proof of a Redis operation.
3. Resolve candidate service/resource edges using client construction, endpoint
   configuration, queue names, deployment wiring and accepted behavior.
4. Preserve dynamic import, reflection, generated code, conditional configuration
   and missing dependency gaps. Runtime observations add evidence; they do not
   erase statically possible unexercised paths.
5. Emit an inspector fragment with analyzer/version and provenance. Merge by
   stable project identity, never just basename or port number.

Draw the normalized graph with [Mermaid](../../diagrams/evidence-model.mmd).
Do not equate SBOM completeness or analyzer exit zero with a complete SUT topology.
