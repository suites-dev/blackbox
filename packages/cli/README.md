# `@suites/blackbox-cli`

Generic oclif command host and sole owner of the `blackbox` executable. Install
this package explicitly alongside [`@suites/blackbox`](../blackbox/README.md),
which owns the default composition and entry skill but has no launcher.
The CLI also supports custom compositions; it depends on neither product features nor Skills.

## Runtime composition

The host reads the consumer's declared dependencies and development dependencies,
resolves installed contributors through their public ESM exports, and traverses
only explicitly contributed module dependencies. Dependencies merely present in
`node_modules` do not activate themselves.

The source checkout is a deliberate composition root using the workspace manifest.
An installed launcher uses its consumer's manifest, even when run from a different
project directory. Command output and project files still use the current working
directory.

Selected packages can independently contribute:

- `blackbox.cli`: oclif commands through the CLI contract.
- `blackbox.skills`: a public `./skills` export containing `skillModule`.
- `blackbox.module`: a public `./module` export containing `blackboxModule`,
  which explicitly selects other declared runtime dependencies.

Skill-only and bundle packages do not need empty oclif plugins. There is no global
registration side effect. The host injects skill contributions through the
per-config CLI context; the generic Skills registry does not discover packages.

## Contribute a module

A bundle declares both its package dependencies and activation entrypoint:

```json
{
  "dependencies": { "example-blackbox-feature": "1.0.0" },
  "exports": { ".": "./dist/index.js", "./module": "./dist/module.js" },
  "blackbox": { "module": { "apiVersion": 1, "export": "./module" } }
}
```

Its ESM module exports:

```ts
import type { BlackboxModule } from '@suites/blackbox-cli-contract';

export const blackboxModule = {
  apiVersion: 1,
  dependencies: ['example-blackbox-feature'],
} as const satisfies BlackboxModule;
```

Resolution starts at the declaring package, so nested pnpm installations work
without hoisting. Module dependencies must be package names present in that
package's `dependencies`. Missing required contributions, unsupported manifests,
cycles, and conflicting installations fail explicitly. A transitive package not
listed in the module export stays inactive.

These modules are executable code from installed dependencies, not a security
sandbox. Install and select only packages trusted by the project.

## Embed the host

`@suites/blackbox-cli/run` exports the shared launcher:

```js
import { runCli } from '@suites/blackbox-cli/run';

await runCli(process.argv.slice(2), {
  installationDirectory: new URL('../', import.meta.url),
});
```

For a launcher at `bin/run.js`, the URL identifies its owning package root.
The standalone `bin/run.js` is also supported. `@suites/blackbox-cli` exports the
CLI exit contract; domain APIs remain in their owning packages.

## Validate

After a frozen workspace install and `pnpm build`, from the repository root:

```sh
pnpm --filter @suites/blackbox-cli lint
pnpm --filter @suites/blackbox-cli test
pnpm test:e2e:skills
```

The package runner compiles tests into a temporary directory and uses Node's test
runner. The main package tests composition and skill copies through the CLI executable. The packed
consumer lane tests public exports and dependency composition outside the workspace.
