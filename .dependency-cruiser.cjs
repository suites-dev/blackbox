const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join, posix } = require('node:path');

// Package boundaries for the workspace. `pnpm check:deps` runs this over
// packages/ and fails on any error. The rule set is derived from the
// package.json files wherever possible, so a renamed export or a new
// dependency does not leave a stale hand-written list behind.

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inPackage = (dir) => `^packages/${escape(dir)}/`;

const PACKAGES = readdirSync(join(__dirname, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(__dirname, 'packages', entry.name, 'package.json')))
  .map((entry) => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, 'packages', entry.name, 'package.json'), 'utf8'),
    );
    return { dir: entry.name, manifest };
  });

// check:deps ignores the violations recorded here. Only fan-in hubs may be
// recorded: a baseline that also held, say, a cycle would hide it for good.
const KNOWN_VIOLATIONS = join(__dirname, '.dependency-cruiser-known-violations.json');
if (existsSync(KNOWN_VIOLATIONS)) {
  const foreign = JSON.parse(readFileSync(KNOWN_VIOLATIONS, 'utf8')).filter(
    (violation) => violation.rule.name !== 'no-high-fan-in',
  );
  if (foreign.length > 0) {
    throw new Error(
      `.dependency-cruiser.cjs: known violations may only hold no-high-fan-in, found ${foreign.map((violation) => violation.rule.name).join(', ')}`,
    );
  }
}

const DIR_BY_NAME = new Map(PACKAGES.map(({ dir, manifest }) => [manifest.name, dir]));

// Test files and the fixtures/helpers only tests load. Mirrors the exclude
// list of every tsconfig.build.json, so "production" here means "compiled
// into dist and published".
const TEST_SUPPORT = '(\\.(test|spec|fixture)\\.[cm]?[jt]s$|/(testing|test-fixtures|__tests__)/)';
// Tooling run from package.json scripts or by vitest, never shipped.
const TOOLING_IN_PACKAGE = '(vitest(\\.integration)?\\.config\\.ts$|scripts/)';
const TOOLING = `^packages/[^/]+/${TOOLING_IN_PACKAGE}`;
const NON_PRODUCTION = [TEST_SUPPORT, TOOLING];

/**
 * Maps a published path (usually `./dist/x.js`) to the source file it is
 * built from. tsconfig.build.json uses rootDir src and outDir dist in every
 * package, so the mapping is mechanical. Non-code targets (JSON schemas)
 * return null because nothing in the import graph has to reach them.
 */
function sourceOf(dir, target) {
  const relative = posix.normalize(target).replace(/^\.\//, '');
  if (!/\.[cm]?[jt]s$/.test(relative)) {
    return null;
  }
  const source = relative.startsWith('dist/')
    ? `src/${relative.slice('dist/'.length)}`.replace(/\.([cm]?)js$/, '.$1ts')
    : relative;
  const path = `packages/${dir}/${source}`;
  // A declared entry with no source is drift, and silently skipping it would
  // turn every module behind it into an unreachable false positive.
  if (!existsSync(join(__dirname, path))) {
    throw new Error(`.dependency-cruiser.cjs: ${dir} declares ${target}, but ${path} is missing`);
  }
  return path;
}

function exportTargets(exportsField) {
  if (typeof exportsField === 'string') {
    return [exportsField];
  }
  if (exportsField === null || typeof exportsField !== 'object') {
    return [];
  }
  return Object.values(exportsField).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : // The blackbox-source condition is what the workspace resolves to;
        // without it the import condition names the built file.
        [value['blackbox-source'] ?? value.import ?? value.default].filter(Boolean),
  );
}

// Everything a package.json makes loadable from outside the import graph:
// export targets (what consumers import), bin targets, and the oclif command
// registry, hooks and help class (loaded by oclif from the manifest).
const MANIFEST_ENTRIES = PACKAGES.flatMap(({ dir, manifest }) => {
  const targets = [...exportTargets(manifest.exports)];
  if (typeof manifest.bin === 'string') {
    targets.push(manifest.bin);
  } else if (manifest.bin) {
    targets.push(...Object.values(manifest.bin));
  }
  const oclif = manifest.oclif ?? {};
  if (oclif.commands && typeof oclif.commands === 'object') {
    targets.push(oclif.commands.target);
  }
  targets.push(...Object.values(oclif.hooks ?? {}).flat());
  if (oclif.helpClass) {
    targets.push(oclif.helpClass);
  }
  return targets.map((target) => sourceOf(dir, target)).filter(Boolean);
});

// Source files behind each package's declared exports. A cross-package import
// must land on one of these; anything else is a deep import.
const EXPORTED_SOURCES = [
  ...new Set(
    PACKAGES.flatMap(({ dir, manifest }) =>
      exportTargets(manifest.exports)
        .map((target) => sourceOf(dir, target))
        .filter(Boolean),
    ),
  ),
].map((path) => `^${escape(path)}$`);

const ENTRY_POINTS = [
  ...[...new Set(MANIFEST_ENTRIES)].map((path) => `^${escape(path)}$`),
  '\\.(test|spec)\\.[cm]?[jt]s$',
  TOOLING,
  // Spawned as a child process by path from session/start.ts.
  '^packages/capsule/src/manager-entry\\.ts$',
  // Playwright configs that fixtures.test.ts hands to the Playwright runner.
  '^packages/playwright/src/testing/[^/]+\\.config\\.ts$',
  // Maintainer script run by hand to refresh the recorded capsule fixture
  // (see the README next to it); nothing imports it.
  '^packages/capsule/src/cli/operations/inspection/testing/fixtures/sanitize-recording\\.mjs$',
];

// The layer order, bottom first. A package may import only packages in a
// STRICTLY lower tier. Same-tier imports are forbidden as well, which makes
// the order total across tiers: any package cycle has to contain a sideways
// or upward edge, so these rules also act as the package-level cycle check
// that no-circular (module level) cannot provide on its own.
//
// Derived from the import graph on 2026-10-02, which satisfies it with no
// exemptions.
const TIERS = [
  {
    name: 'foundation',
    why: 'contracts and standalone runtimes with no workspace dependencies',
    packages: [
      'cli-contract',
      'telemetry',
      'instrumentation',
      'otel-collector',
      'report-server',
      'sandbox',
    ],
  },
  {
    name: 'services',
    why: 'shared services built only on the foundation',
    packages: ['skills', 'driver'],
  },
  {
    name: 'plugins',
    why: 'feature packages and runtime adapters built on services',
    packages: ['catalog', 'discovery', 'instrumentation-runtime-node'],
  },
  {
    name: 'composition',
    why: 'composition roots that wire plugins into one product surface',
    packages: ['capsule', 'playwright'],
  },
  {
    name: 'host',
    why: 'the CLI binary, which loads plugins at runtime instead of importing them',
    packages: ['cli'],
  },
];

const tiered = TIERS.flatMap((tier) => tier.packages);
const untiered = PACKAGES.map(({ dir }) => dir).filter((dir) => !tiered.includes(dir));
if (untiered.length > 0) {
  // A package outside every tier would be unconstrained by the layer rules.
  throw new Error(`.dependency-cruiser.cjs: no tier declared for ${untiered.join(', ')}`);
}

const layerRules = TIERS.flatMap((tier, rank) => {
  const atOrAbove = TIERS.slice(rank).flatMap((other) => other.packages);
  return tier.packages
    .map((dir) => ({
      name: `layer-${dir}`,
      severity: 'error',
      comment: `${dir} is in the ${tier.name} tier (${tier.why}). It may import only packages in lower tiers; a same-tier or higher import is a layering inversion or a package cycle.`,
      from: { path: inPackage(dir) },
      to: { path: atOrAbove.filter((other) => other !== dir).map(inPackage) },
    }))
    .filter((rule) => rule.to.path.length > 0);
});

// pnpm links workspace packages by symlink, so dependency-cruiser classifies
// them as 'undetermined' instead of npm and its package.json rules never see
// them. These rules check the same thing from the manifests directly.
const workspaceNames = (fields) =>
  fields.flatMap((field) => Object.keys(field ?? {})).filter((name) => DIR_BY_NAME.has(name));

const declaredWorkspaceRules = PACKAGES.flatMap(({ dir, manifest }) => {
  const runtime = workspaceNames([
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]);
  const all = [...runtime, ...workspaceNames([manifest.devDependencies])];
  const others = (allowed) =>
    PACKAGES.map((other) => other.dir).filter(
      (other) => other !== dir && !allowed.some((name) => DIR_BY_NAME.get(name) === other),
    );
  return [
    {
      name: `declared-workspace-deps-${dir}`,
      severity: 'error',
      comment: `Production code in ${dir} may import only workspace packages listed in its own dependencies, peerDependencies or optionalDependencies. A devDependency is not installed for a consumer of the published package.`,
      from: { path: inPackage(dir), pathNot: NON_PRODUCTION },
      to: { path: others(runtime).map(inPackage) },
    },
    {
      name: `declared-workspace-dev-deps-${dir}`,
      severity: 'error',
      comment: `Tests and tooling in ${dir} may import only workspace packages listed in its own package.json. Resolving through another package's node_modules works only by accident of the pnpm layout.`,
      from: {
        path: [`${inPackage(dir)}(?=.*${TEST_SUPPORT})`, `${inPackage(dir)}${TOOLING_IN_PACKAGE}`],
      },
      to: { path: others(all).map(inPackage) },
    },
  ].filter((rule) => rule.to.path.length > 0);
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle between modules, type-only edges included. A runtime cycle lets load order decide which side sees the other half-initialized; a type-only one still ties two modules together. Move the shared declarations into a leaf module. The layer rules cover the package-level case that has no module cycle.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unreachable-from-entry-points',
      severity: 'error',
      comment:
        'A module no entry point reaches is dead code. Entry points are what something outside the graph loads: package.json exports, bin and oclif targets, test files, and package tooling. Reachable from a test only still counts as reachable.',
      from: { path: ENTRY_POINTS },
      to: { path: '^packages/', pathNot: ENTRY_POINTS, reachable: false },
    },
    {
      name: 'no-cross-package-relative-import',
      severity: 'error',
      comment:
        'Import another workspace package by its @suites name. A relative path skips its exports map and its build, and breaks once the packages are installed from a registry.',
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/', pathNot: '^packages/$1/', dependencyTypes: ['local'] },
    },
    {
      name: 'cross-package-imports-use-declared-exports',
      severity: 'error',
      comment:
        "A cross-package import must land on a file behind one of the target's package.json exports. Resolution already rejects undeclared subpaths such as @suites/x/src/y.js; this also catches any route around the exports map.",
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/', pathNot: ['^packages/$1/', ...EXPORTED_SOURCES] },
    },
    ...layerRules,
    {
      name: 'cli-host-imports-only-the-contract',
      severity: 'error',
      comment:
        'The CLI host discovers plugins from project package.json files at runtime. A static import of a plugin would bundle it into every install and bypass discovery; shared types belong in cli-contract.',
      from: { path: inPackage('cli') },
      to: { path: '^packages/', pathNot: [inPackage('cli'), inPackage('cli-contract')] },
    },
    {
      name: 'cli-contract-is-dependency-free',
      severity: 'error',
      comment:
        'cli-contract is the CLI surface as plain data and types, so a plugin can depend on it without pulling in the host or oclif. Only Node built-ins are allowed.',
      from: { path: inPackage('cli-contract') },
      to: { pathNot: inPackage('cli-contract'), dependencyTypesNot: ['core'] },
    },
    {
      name: 'only-the-playwright-package-imports-playwright',
      severity: 'error',
      comment:
        'packages/playwright is the one integration with the Playwright test runner. Every other package stays framework-neutral.',
      from: { pathNot: inPackage('playwright') },
      to: { path: '(^|/)node_modules/(@playwright/|playwright(-core)?/)' },
    },
    {
      name: 'runtime-adapters-are-composition-only',
      severity: 'error',
      comment:
        'Language runtime adapters are optional leaves. Only a composition root selects one; everything else works from the language-neutral contract in instrumentation.',
      from: {
        path: '^packages/',
        pathNot: ['^packages/playwright/', '^packages/instrumentation-runtime-[^/]+/'],
      },
      to: { path: '^packages/instrumentation-runtime-[^/]+/' },
    },
    {
      name: 'command-does-not-import-command',
      severity: 'error',
      comment:
        'Each oclif command module is a leaf that delegates to its package functions. Commands chaining into each other hide behavior behind another command surface.',
      from: { path: '/cli/commands/', pathNot: TEST_SUPPORT },
      to: { path: '/cli/commands/' },
    },
    {
      name: 'no-high-fan-in',
      severity: 'error',
      comment:
        "A production module that more than 15 production modules import is a hub: every change to it ripples through all of them. Split it by consumer. Barrels are exempt because re-exporting is their job. Today's hubs are locked in .dependency-cruiser-known-violations.json, which may only shrink.",
      module: {
        path: '^packages/[^/]+/src/',
        pathNot: [...NON_PRODUCTION, '/index\\.ts$'],
        numberOfDependentsMoreThan: 15,
      },
      from: { pathNot: NON_PRODUCTION },
    },
    ...declaredWorkspaceRules,
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'Every import must resolve. An unresolved specifier is a missing dependency, a typo, or an undeclared export subpath.',
      // bin/ loads its own compiled dist/, which exists only after a build.
      from: { pathNot: '^packages/[^/]+/bin/' },
      to: { couldNotResolve: true },
    },
    {
      name: 'bin-loads-only-its-own-build',
      severity: 'error',
      comment:
        'A bin script is the one place allowed to reach compiled output, and only its own package dist/.',
      from: { path: '^packages/([^/]+)/bin/' },
      to: {
        dependencyTypesNot: ['core', 'npm'],
        pathNot: ['^packages/$1/(dist|bin)/', '^\\.\\./dist/'],
      },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment:
        "An npm import must be declared in the importing package's own package.json. Resolving through the root or a hoisted node_modules works in this checkout and fails for a consumer.",
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Production code may not import a devDependency, type-only included: published declarations reference it too. Move it to dependencies or peerDependencies.',
      from: { path: '^packages/', pathNot: NON_PRODUCTION },
      to: {
        dependencyTypes: ['npm-dev'],
        // Also listed as a runtime or peer dependency, so a consumer has it.
        dependencyTypesNot: ['npm', 'npm-peer', 'npm-optional'],
      },
    },
    {
      name: 'workspace-imports-resolve-to-source',
      severity: 'error',
      comment:
        "A workspace import resolved into another package's dist/. Its exports entry lacks the blackbox-source condition, so the check would read stale build output instead of source.",
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/[^/]+/dist/', pathNot: '^packages/$1/dist/' },
    },
  ],
  options: {
    // Coverage output and the per-package lint config are not part of the
    // product graph. dist/ is not excluded, only not followed: excluding it by
    // a bare `dist/` pattern also dropped every npm module whose entry lives
    // in a dist/ folder (vitest, ajv), hiding them from the package.json rules.
    exclude: { path: '^packages/[^/]+/(coverage[^/]*/|eslint\\.config\\.mjs$)' },
    doNotFollow: { path: ['(^|/)node_modules/', '^packages/[^/]+/dist/'] },
    // The root tsconfig carries the blackbox-source custom condition. Workspace
    // packages resolve through their pnpm links and exports maps, so no
    // cruise-specific paths file is needed, and none can bypass exports.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['blackbox-source', 'import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      archi: { collapsePattern: '^packages/[^/]+' },
    },
  },
};
