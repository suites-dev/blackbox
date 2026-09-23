import rootConfig from '../../eslint.config.mjs';

// Per-package lint entry point, so `pnpm --filter <name> lint` can lint this
// package on its own. It re-exports the root config and relaxes nothing.
//
// `basePath` is the load-bearing part, not boilerplate. A flat config's `files`
// and `ignores` patterns resolve against the directory of the config that
// declares them, so running eslint from here would resolve the ROOT config's
// patterns against THIS directory. Several of them are anchored at the repo
// root ('packages/cli/src/commands/**', '**/config/**/schema.ts', 'e2e/sut/**',
// 'packages/*/node-agent/**'), and those quietly stop matching. Measured, not
// assumed: without this, a package-local run reported seven findings in cli and
// two in config that the root sweep does not, because the overrides exempting
// them had gone inert. Rebasing every object on the repo root makes the two
// runs agree by construction. tsconfigRootDir is already pinned to the repo
// root by the config itself, so the typed rules resolve the same program too.
export default rootConfig.map((entry) => ({ ...entry, basePath: '../..' }));
