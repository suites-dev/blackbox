# Dependency inspector recipes

These recipes route to ecosystem tools already available in the user's environment.
They are not bundled implementations. Read tool help and configuration before
execution; a parser plugin or executable manifest can run code. Do not install,
restore dependencies or access registries without approval.

| Ecosystem | Inputs and concrete probe | Interpretation and limitations |
| --- | --- | --- |
| Node/JS/TS | Workspace/lockfiles, startup scripts; `pnpm exec dependency-cruiser src --output-type json` after reviewing its configuration | Normalize `modules[].source` and dependencies into module/import edges. Record unresolved imports. JSON or Mermaid output is not a microservice topology. Resolve aliases, generated files and dynamic imports explicitly. |
| JVM | POM/Gradle files and built classes/JARs; `jdeps --recursive -verbose:class app.jar` | Class/archive dependency graph, not HTTP calls or deployed instances. Reflection/DI may remain unresolved. Maven/Gradle tasks execute plugins and may fetch dependencies. WALA/SootUp are optional deeper call-graph tools, not startup discovery substitutes. |
| Python | pyproject/lockfiles and AST import nodes; trusted pydeps for module analysis; `python -m pip inspect --local` for an installed environment | Installed distributions, source modules and dynamic imports are different evidence. Do not import the application or evaluate setup.py just to inspect it. Review interpreter startup hooks and analyzer behavior. |
| Go | go.mod/go.work, main packages and `go list -deps -json ./...` | Preserve package vs module identity and build tags/platform. The command can require dependency/toolchain downloads; use an approved offline/cache policy and report misses. |
| Rust | Cargo.toml/Cargo.lock; `cargo metadata --format-version 1 --locked --offline` | Package/workspace graph and selected features, not service calls. An offline miss is a blocker. Building, tests, build.rs and procedural macros belong to execution, not static inventory. |
| .NET | Solution/project files, project.assets.json; installed CLI's `dotnet package list --include-transitive --format json --no-restore` or earlier `dotnet list package` form | NuGet dependencies differ from symbol/call edges. Use Roslyn only where needed. Tool versions change command order; inspect help. Restore/MSBuild evaluation is not pure file reading. |
| Ruby | Gemfile.lock, require sites, Rails routes/jobs and configuration; trusted `bundle list` after configuration review | Gems do not identify service instances. Gemfile and framework boot can execute Ruby. Keep metaprogramming and generated routes unresolved until safely inspected. |

A command unavailable in the installed version must produce a blocked inspector
result, not a guessed replacement. Existing trusted project analysis tooling is
preferable to imposing a new analyzer just to fill every graph layer.

## Normalize into a common graph

1. Assign stable IDs qualified by repository/workspace and layer.
2. Emit `package` and `module` nodes with `source` edges from static analyzers.
3. Establish code-to-participant `implements` edges from build outputs and launch
   commands. A package name or matching basename is insufficient.
4. Map client constructors/configuration and protocol operations to candidate
   `behavioral` edges between participants/resources. Mark inference as inference.
5. Add startup/state/observation dependencies as `requires` edges and deployment
   relationships as `deployment` edges. Do not use a deployment graph as a call graph.
6. Attach runtime occurrences only to the exact Capsule evidence scope. Do not
   treat an unobserved edge as impossible. Preserve provenance and contradictions.

SBOM formats such as SPDX/CycloneDX can supply component identity and package
relationships. They do not establish executable startup order, business paths or
runtime dependency completeness. No transitive library becomes a container merely
because it appears in the SBOM.

## Adapter contract

An adapter returns an `inspector-result` with its name and version. `inspected`
contains graph and evidence; `blocked` and `failed` contain reasons. Normalize
foreign JSON only after shape checks. Do not merge unknown IDs silently. Resource
identity includes environment/namespace, not only a port or product name.

Sources: [dependency-cruiser JSON](https://github.com/sverweij/dependency-cruiser/blob/main/doc/output-format.md),
[jdeps](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html),
[pip inspect](https://pip.pypa.io/en/stable/cli/pip_inspect/),
[Go modules](https://go.dev/ref/mod),
[Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html),
[.NET package listing](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-list).
