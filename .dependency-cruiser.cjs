const inPackage = (name) => `^packages/${name}/`;

// The public facade owns the documented Playwright config entry point. It is
// the only non-adapter module allowed to import Playwright directly; the
// facade delegates runtime behavior to runner-playwright, but its type-only
// config import is part of the public native Playwright integration boundary.
const PLAYWRIGHT_IMPORTERS = [
  inPackage('runner-playwright'),
  '^packages/blackbox/playwright\\.ts$',
];

// Files something OUTSIDE the import graph loads directly, so nothing inside
// packages/ needs to import them: a test runner invoking each test file, a
// package barrel an external consumer imports, config-section.ts and
// capability-adapter.ts (discovered by name from a package.json blackbox
// block, never statically imported), the CLI binary and every command file
// (loaded by oclif's plugin discovery), the node-agent payload (runs inside a
// container, outside this graph entirely), a handful of standalone tsx
// scripts, and cli/type-bridges.ts (a type-only drift guard tsc includes via
// the tsconfig glob; nothing needs to import it). Used both as the entry set
// a module must be reachable from, and as the exemption list so an entry
// point does not fail the check by being "unreachable" from itself.
//
// Each package-relative pattern below carries an optional `src/` (or `tests/`)
// segment. Packages are moving to the conventional `src/` + `tests/` layout one
// at a time, so during that migration both spellings exist in the tree at once,
// and a pattern pinned to exactly one of them would stop matching the moment
// its package moved. A missed entry point only downgrades modules to
// "unreachable", which is a WARNING, so that breakage would not fail the cruise
// and would be easy to overlook. Hence the optional segment rather than
// flipping the paths package by package.
//
// `bin/` gets no optional segment on purpose: packages/cli/bin is a published
// artifact directory listed in that package's `files`, so it stays at the
// package root and never moves under src/.
const ENTRY_POINTS = [
  '\\.test\\.ts$',
  '/index\\.ts$',
  '/config-section\\.ts$',
  '^packages/[^/]+/(src/)?capability-adapter\\.ts$',
  '^packages/cli/bin/',
  '^packages/[^/]+/(src/)?commands/',
  '^packages/collection-http/(src/)?server\\.ts$',
  '^packages/evidence/(src/)?collector/server\\.ts$',
  '^packages/execution/(src/)?manager-process\\.ts$',
  // `adapter` is deliberately absent from this alternation: commit 986721d6
  // ("delete bb run and RunnerPort surface") removed the file, and the dead
  // branch survived here for months because an alternation matches overall as
  // long as ANY branch matches, and reporter and global-setup both still do.
  // Nothing reports a branch that matches nothing, so "the pattern matched
  // something" is not evidence that every branch is live. Split on | and check
  // each branch separately when auditing this list.
  '^packages/runner-playwright/(src/)?(reporter|global-setup)\\.ts$',
  '^packages/runner-playwright/(tests/)?test-fixtures/real-playwright/multi-file-sut',
  '^packages/capture-node/(src/)?generate-override\\.ts$',
  '^packages/cli/(src/)?type-bridges\\.ts$',
  '/node-agent/',
];

// The layer order, declared once. Every package sits at exactly one rank, and
// a package may import only STRICTLY LOWER ranks.
//
// Distinct ranks are the point, not an accident of formatting. Because the
// order is total, any cycle in the graph must contain at least one edge that
// runs upward, so a cycle of any length between any packages is guaranteed to
// trip the generated rules below. That guarantee is what replaces a dedicated
// package-cycle rule: dependency-cruiser 16 treats `reachable` and `via` as
// mutually exclusive, so "reaches back into itself through another package"
// cannot be expressed directly, and a rule that cannot be expressed is a rule
// that silently passes.
//
// Ranks reflect the TARGET architecture from packages/README.md, not today's
// import graph. Several current edges violate this, which is the intended
// outcome: the file is meant to fail until the ports that replace those edges
// exist.
const LAYERS = [
  ['protocol'],
  ['evidence'],
  ['cli-contract'],
  ['catalog'],
  ['collection-http'],
  ['system'],
  ['spec'],
  ['spec-playwright'],
  ['testbed'],
  ['capture-node'],
  ['odc'],
  ['odc-node'],
  ['execution'],
  ['analyzer'],
  ['report'],
  ['runner-playwright'],
  ['cli'],
  // Optional command plugins. They sit at the top because nothing in the core
  // may reach them; what they are themselves allowed to import is constrained
  // by plugins-do-not-import-the-cli-host below.
  ['spec-gherkin'],
];

/**
 * One rule per package forbidding every import at its own rank or above.
 * Same-rank pairs are included, so two packages sharing a layer still may not
 * reach each other.
 */
const layerRules = LAYERS.flatMap((packagesAtRank, rank) => {
  const atOrAbove = LAYERS.slice(rank).flat();
  return packagesAtRank
    .map((name) => ({
      name: `layer-${name}`,
      severity: 'error',
      comment: `${name} may import only packages below it in the declared layer order. An import at its own rank or above is either a cycle or a missing port.`,
      from: { path: inPackage(name) },
      to: { path: atOrAbove.filter((other) => other !== name).map(inPackage) },
    }))
    .filter((rule) => rule.to.path.length > 0);
});

const evidenceIncomingRules = [
  {
    name: 'evidence-importers-are-allowlisted',
    severity: 'error',
    comment:
      'Only the temporary collection-http/capture-node adapters, execution, analyzer, runner-playwright, cli, and evidence itself may import evidence. Catalog, protocol, system, runtime-node, report, and cli-contract must stay off this package.',
    from: {
      path: '^packages/[^/]+/',
      pathNot:
        '^packages/(collection-http|capture-node|execution|analyzer|runner-playwright|cli|evidence)/',
    },
    to: { path: inPackage('evidence') },
  },
  {
    name: 'analyzer-evidence-requires-read-only-port',
    severity: 'error',
    comment:
      'Analyzer may consume only a dedicated read-only validated-artifact API from evidence. None exists yet: execution-store.ts mixes readers and writers, and collector modules own OTLP writes and process lifecycle. Keep direct analyzer imports out of evidence until a separate reader-only module is added.',
    from: { path: inPackage('analyzer') },
    to: { path: inPackage('evidence') },
  },
];

/**
 * The retained-byte stores and the run fence must stay importable without
 * side effects. A store that reached the collector would start a process and
 * bind a port merely by being imported, which is exactly what keeps the
 * evidence barrel free of the collector today.
 */
const evidenceInternalRules = [
  {
    name: 'evidence-stores-must-not-import-the-collector',
    severity: 'error',
    comment:
      'capture-state, acquisition-store, evidence-write, run-track and execution-store are pure byte stores and coordination. Importing collector code from any of them would make writing one artifact able to start a server.',
    from: {
      path: '^packages/evidence/src/(capture-state|acquisition-store|evidence-write|run-track|execution-store)\\.ts$',
    },
    to: { path: '^packages/evidence/src/collector/' },
  },
  {
    name: 'evidence-stores-coordinate-through-the-one-fence',
    severity: 'error',
    comment:
      'Every evidence byte store takes the run write lease from capture-state.ts. A store that imported node:fs locking or reimplemented the lease would be a second fence, which is the defect #201 removed.',
    from: { path: '^packages/evidence/src/capture-state\\.ts$' },
    to: {
      path: '^packages/evidence/src/(acquisition-store|evidence-write|run-track|execution-store)\\.ts$',
    },
  },
];

const evidenceOutgoingRules = [
  {
    name: 'evidence-imports-must-resolve',
    severity: 'error',
    comment:
      'Every evidence import must resolve to a concrete target. Unresolved package specifiers can disappear from a packed consumer graph and bypass the evidence boundary.',
    from: { path: inPackage('evidence') },
    to: { couldNotResolve: true },
  },
  {
    name: 'evidence-imports-protocol-only',
    severity: 'error',
    comment:
      'Evidence is a generic retained-data and collector package. It may import its own modules, the language-neutral protocol, Node built-ins, and external packages resolved under node_modules. Any other resolved target path violates the boundary, regardless of dependency-cruiser classification.',
    from: { path: inPackage('evidence') },
    to: {
      couldNotResolve: false,
      dependencyTypesNot: ['core'],
      pathNot: [inPackage('evidence'), inPackage('protocol'), '(^|/)node_modules(/|$)'],
    },
  },
];

// Production imports must resolve through package exports on every route.
// Tests may inspect sibling sources; rootDir also enforces the build boundary.
const crossPackageRelativeImportRules = [
  {
    name: 'no-cross-package-relative-imports',
    severity: 'error',
    from: { path: '^packages/([^/]+)/src/', pathNot: '\\.(test|spec)\\.ts$' },
    to: {
      path: '^packages/',
      pathNot: '^packages/$1/',
      dependencyTypes: ['local'],
      dependencyTypesNot: ['aliased'],
    },
  },
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...layerRules,
    ...evidenceIncomingRules,
    ...evidenceInternalRules,
    ...evidenceOutgoingRules,
    ...crossPackageRelativeImportRules,
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle between individual modules. See no-package-cycle for the coarser case this cannot detect.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'protocol-is-dependency-free',
      severity: 'error',
      comment:
        'protocol carries evidence contracts, capability ports, and the null implementations. It is the bottom of the stack and imports no sibling and no runtime.',
      from: { path: inPackage('protocol') },
      to: {
        path: '^packages/',
        pathNot: inPackage('protocol'),
      },
    },
    {
      name: 'cli-contract-is-dependency-free',
      severity: 'error',
      comment:
        'cli-contract is the shared CLI surface as data. It is dependency-free INCLUDING on oclif: anything it would need from oclif is expressed as a plain type instead, so a plugin never pulls the host in through it.',
      from: { path: inPackage('cli-contract') },
      to: {
        pathNot: inPackage('cli-contract'),
        path: ['^packages/', '/node_modules/@oclif/'],
      },
    },
    {
      name: 'config-sections-import-protocol-only',
      severity: 'error',
      comment:
        'A config-section module is loaded by the kernel before any package runtime exists, so it may import the protocol types and node built-ins only. Importing a sibling section couples two packages at wiring time; importing a package barrel closes a cycle, because the barrel reads resolved config and the section is what produces it.',
      from: { path: '^packages/([^/]+)/(src/)?config-section\\.ts$' },
      to: {
        path: '^packages/',
        // The schema module is handled separately below.  Keeping it out of
        // this rule lets dependency-cruiser distinguish its type-only module
        // augmentation edge from an eager runtime dependency.
        pathNot: ['^packages/protocol/', '^packages/$1/', '^packages/catalog/src/schema\\.ts$'],
      },
    },
    {
      name: 'config-sections-schema-bridge-is-type-only',
      severity: 'error',
      comment:
        'Temporary cleanup #91 bridge: config-section.ts may augment the config schema with an import type, but must never eagerly load it. No package barrel or other config module is included in this exception.',
      from: { path: '^packages/([^/]+)/(src/)?config-section\\.ts$' },
      to: {
        path: '^packages/catalog/src/schema\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'core-never-imports-an-optional-package',
      severity: 'error',
      comment:
        'Optional adapters must not be eagerly loaded by production code. Type-only imports, explicit lazy imports, and tests do not make an adapter execute at startup.',
      from: {
        pathNot: [
          '^packages/spec-gherkin/',
          '^packages/odc-node/',
          '^packages/odc/',
          '\\.(test|spec)\\.ts$',
        ],
      },
      to: {
        dynamic: false,
        dependencyTypesNot: ['type-only'],
        path: ['^packages/spec-gherkin/', '^packages/odc-node/', '^packages/odc/'],
      },
    },
    {
      // M4 D3: generalized from spec-gherkin to also cover
      // report, now that report declares its own `blackbox.commands`
      // manifest block (M4 D3) and is therefore, like they are, a
      // command-owning package rather than only a library the host imports.
      name: 'plugins-no-cli-host',
      severity: 'error',
      comment:
        'A command-owning plugin may never import the CLI host. Shared code lives in cli-contract; commands receive a CommandIo interface rather than an oclif Command type.',
      from: { path: ['^packages/spec-gherkin/', inPackage('report')] },
      to: { path: inPackage('cli') },
    },
    {
      name: 'report-input-is-validated-loader-output',
      severity: 'error',
      comment:
        'html.ts renders only the validated loader family a run store produces (LoadedAnalysis, LoadedAnalysisIndex, LoadedCliExploration, LoadedReport, from @suites/blackbox-analyzer/ledger) plus protocol value types. It must not reach any other package directly: doing so would let it read raw evidence, capture data, or execution state and derive a competing verdict instead of only rendering what its own input hands it. (Renamed/generalized from the narrower "report accepts Analysis only" framing now that the validated loader family also covers indexed and CLI-exploration input; see AUDIT-LOG M4 D3.)',
      from: { path: '^packages/report/(src/)?html\\.ts$' },
      to: {
        path: '^packages/',
        pathNot: [inPackage('protocol'), inPackage('analyzer'), inPackage('report')],
      },
    },
    {
      name: 'command-does-not-import-command',
      severity: 'error',
      comment:
        "A command module (any file under a package's commands/ directory, discovered by oclif or, in future, by the M5 E2 composition scan) may not import another command module, in its own package or any other. Each command is a leaf: it delegates to its own package's public functions, never to another command's implementation. This is what keeps \"command-per-capability\" meaningful, rather than commands quietly chaining into each other the way plain functions would.",
      from: { path: '(^|/)commands/' },
      to: { path: '(^|/)commands/' },
    },
    {
      name: 'only-system-reaches-its-compose-adapter',
      severity: 'error',
      comment:
        'The Compose/Testcontainers adapter is an internal module of system. Every other package consumes the SystemDriver contract and obtains an instance through resolveSystemDriver(); a direct import of the adapter would defeat that inversion and drag the container runtime into a port-only import.',
      from: { path: '^packages/', pathNot: '^packages/system/' },
      to: { path: '^packages/system/src/compose/' },
    },
    {
      name: 'compose-adapter-does-not-own-instrumentation',
      severity: 'error',
      comment:
        "system's Compose adapter receives instrumentation through the protocol port and never imports the Node capture implementation.",
      from: { path: '^packages/system/src/compose/' },
      to: { path: inPackage('capture-node') },
    },
    {
      name: 'analyzer-stays-offline',
      severity: 'error',
      comment:
        'analyzer turns SEALED evidence into verdicts. It must not reach into provisioning, online capture, or the trace store directly, or offline analysis stops being reproducible from evidence alone. This is why the effects projection, its ODC adapter, V8 coverage processing, and the trace execution-path view live in capture-node rather than here (S2): all four consume evidence online (live trace-store fetches, in-container coverage), which analyzer by definition does not. collection-http is included even though it sits below analyzer in LAYERS: a lower rank is permission to import, not a requirement to, and analyzer reading the trace store live is exactly the online reach this rule exists to keep out.',
      from: { path: inPackage('analyzer') },
      to: {
        path: [
          inPackage('testbed'),
          inPackage('capture-node'),
          inPackage('runner-playwright'),
          inPackage('collection-http'),
          inPackage('system'),
          inPackage('execution'),
        ],
      },
    },
    {
      name: 'testbed-is-runtime-neutral',
      severity: 'error',
      comment:
        'testbed boots containers. What gets injected INTO a container is an instrumentation concern and belongs behind a port, not behind an import of the capture package.',
      from: { path: inPackage('testbed') },
      to: {
        path: [
          inPackage('capture-node'),
          inPackage('analyzer'),
          inPackage('runner-playwright'),
          inPackage('report'),
        ],
      },
    },
    {
      name: 'capture-is-not-a-driver',
      severity: 'error',
      comment:
        'capture-node produces evidence. Walking the compose model and provisioning containers is driver work that belongs to testbed.',
      from: { path: inPackage('capture-node') },
      to: { path: [inPackage('testbed'), inPackage('runner-playwright')] },
    },
    {
      name: 'cli-imports-no-test-framework',
      severity: 'error',
      comment:
        'blackbox run executes through the runner PORT. The composition root must never import a test framework, directly or through the Playwright adapter.',
      from: { path: inPackage('cli') },
      to: {
        path: [inPackage('runner-playwright'), '/node_modules/@playwright/'],
      },
    },
    {
      name: 'only-the-playwright-adapter-imports-playwright',
      severity: 'error',
      comment:
        'runner-playwright and the explicit public Playwright facade are the only modules permitted to import @playwright/test. Other core modules must remain framework-neutral.',
      from: { pathNot: PLAYWRIGHT_IMPORTERS },
      to: { path: '/node_modules/@playwright/' },
    },
    {
      name: 'no-unreachable-from-entry-points',
      severity: 'warn',
      comment:
        "A module nothing outside the graph can reach is dead code. This replaces a former no-orphans rule that used dependency-cruiser's built-in 'orphan' check (zero incoming AND zero outgoing dependencies): no real module here has zero outgoing dependencies (every file imports at least a type or a node builtin), so that rule could never fire, and a rule that cannot fire reads as enforcement while providing none. This one asks the question that was actually meant: is this module reachable, directly or transitively, from a REAL entry point. ENTRY_POINTS lists what actually gets loaded from outside the import graph rather than being imported: every test file (tsx --test runs each one directly), every package's barrel (an external consumer's import target), config-section.ts and capability-adapter.ts (discovered by name from package.json's blackbox block, never statically imported), the CLI binary and every command file under a commands/ directory (loaded by oclif's plugin discovery, not imported), the mounted node-agent payload (runs inside a container, outside this graph entirely), a handful of standalone tsx scripts (generate-override.ts, collection-http/server.ts), and cli/type-bridges.ts (a type-only compile-time drift guard tsc includes via the tsconfig glob; nothing needs to import it for its check to run). A module matching neither ENTRY_POINTS nor reachable from one is worth a look.",
      from: { path: ENTRY_POINTS },
      to: {
        path: '^packages/',
        pathNot: ENTRY_POINTS,
        reachable: false,
      },
    },
  ],
  options: {
    // dist/ is build output, not source. eslint.config.mjs is tooling
    // configuration: each package now carries one that re-exports the root
    // config, and the cruise would otherwise count all of them as modules that
    // nothing imports and report each as unreachable dead code. A lint config
    // is loaded by eslint, not by this graph, so it is excluded rather than
    // added to ENTRY_POINTS; that keeps the entry-point list a statement about
    // runtime entry points only.
    exclude: '((^|/)dist/|(^|/)eslint\\.config\\.mjs$)',
    doNotFollow: { path: 'node_modules' },
    // The build config intentionally has no paths. This cruise-only config maps
    // every workspace export to its blackbox-source target, exposing package
    // edges without requiring dist/ to exist.
    tsConfig: { fileName: 'tsconfig.dependency-cruiser.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['blackbox-source', 'import', 'require', 'node', 'default'],
    },
  },
};
