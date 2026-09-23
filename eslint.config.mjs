import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unicornPlugin from 'eslint-plugin-unicorn';
import prettierConfig from 'eslint-config-prettier';

const IGNORE_PATTERNS = [
  'node_modules',
  '**/node_modules/**',
  '.claude/**',
  'dist',
  '**/dist/**',
  'coverage',
  '**/coverage/**',
  '.baseline/**',
  'maintainers/**',
  'full-final-product/**',
  '**/*.d.ts',
  '**/*.d.cts',
  '**/*.tsbuildinfo',
  '**/*.map',
  'pnpm-lock.yaml',
  'package-lock.json',
  '.dependency-cruiser.cjs',
  'eslint.config.mjs',
  'commitlint.config.cjs',
  '**/vitest.config.ts',
  '**/*.proposal.ts',
  'e2e/sut/**',
  'packages/*/node-agent/**',
  'poc-demo-verification/**',
];

const typedFilePatterns = ['**/*.ts', '**/*.mts', '**/*.cts'];
const testFilePatterns = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/__tests__/**/*.ts',
  '**/test/**/*.ts',
  '**/test-fixtures/**/*.ts',
];

const baseGlobals = { ...globals.es2024, ...globals.node };

const OPTIONAL_PROPERTY_SELECTOR = 'TSPropertySignature[optional=true]';

const NO_DYNAMIC_IMPORT = {
  selector: 'ImportExpression',
  message:
    'Dynamic imports are not allowed. Use a static import or inject an explicit loader port.',
};

const CONFIG_SURFACE_FILES = [
  '**/*-section.ts',
  '**/config/**/schema.ts',
  'packages/catalog/src/schema.ts',
  // `EffectsPropertyMatchers` / `SummaryRule` (Task 189): the argument a suite
  // author passes to `toMatchBaseline`. Omitting a category means "compare it
  // exactly", which is precisely the `?:` contract - spelling it
  // `T | undefined` would force every author to write out every category.
  'packages/runner-playwright/src/effects-candidate-matching.ts',
];

const RESTRICTED_SYNTAX = [
  NO_DYNAMIC_IMPORT,
  {
    // No double type assertions
    selector: 'TSAsExpression > TSAsExpression',
    message:
      'Double type assertions (x as unknown as Y) are not allowed. Fix the underlying type instead of forcing a cast.',
  },
  {
    // No `x as any` cast — escape hatch. `no-explicit-any` only catches
    // `: any` annotations; the cast form needs an AST rule of its own.
    selector: 'TSAsExpression > TSAnyKeyword',
    message:
      '`as any` is forbidden. Fix the underlying type or refactor the API so the cast is unneeded.',
  },
  {
    // No `x as never` cast — same reasoning. Returning `as never` from a
    // stub function is a sign the function should not exist, or the
    // surrounding type contract is wrong.
    selector: 'TSAsExpression > TSNeverKeyword',
    message:
      '`as never` is forbidden. Replace the stubbed value with a real one, or refactor the type so the cast is unneeded.',
  },
  {
    // No "I" prefix on interfaces (TypeScript structural typing)
    selector: 'TSInterfaceDeclaration[id.name=/^I[A-Z]/]',
    message:
      'Do not prefix interfaces with "I". TypeScript uses structural typing.',
  },
  // NO OPTIONAL PROPERTIES IN INTERFACES / TYPES — use discriminated unions
  // or separate narrow interfaces. Optional properties create exponential
  // state space (2^n combinations) and push correctness to runtime.
  {
    selector: OPTIONAL_PROPERTY_SELECTOR,
    message:
      'Optional properties ("?") are not allowed. Use discriminated unions or separate narrow interfaces instead. Each interface should represent ONE valid shape with all fields required.',
  },
  // NO OPTIONAL FUNCTION / METHOD PARAMETERS — use overloads or
  // discriminated union params.
  {
    selector:
      ':function > .params > :matches(Identifier, AssignmentPattern)[optional=true]',
    message:
      'Optional function parameters ("?") are not allowed. Use separate functions, method overloads, or a discriminated union parameter type instead.',
  },
  // NO OPTIONAL CHAINING (?.). Be explicit about presence checks; narrow
  // types so the access is unconditional.
  {
    selector: 'ChainExpression',
    message:
      'Optional chaining ("?.") is not allowed. Narrow the type explicitly or check presence before access.',
  },
  // NO MEMBER OPTIONAL (foo?.bar). Same reasoning.
  {
    selector: 'MemberExpression[optional=true]',
    message:
      'Optional member access ("?.") is not allowed. Narrow the type explicitly.',
  },
  // NO OPTIONAL CALL (foo?.()). Same reasoning.
  {
    selector: 'CallExpression[optional=true]',
    message:
      'Optional call ("?.()") is not allowed. Narrow the type explicitly.',
  },
  // PREFER `satisfies` — use `= { ... } satisfies Type` instead of
  // `: Type = { ... }`. `satisfies` preserves narrow / literal types
  // while still validating the shape against `Type`. A type annotation
  // widens to `Type`, losing the literal information.
  {
    // Skip EMPTY object literals — `const acc: Record<...> = {}` is the
    // only clean way to declare a typed empty accumulator (`satisfies {}`
    // doesn't carry the index signature). Non-empty literals must use
    // `satisfies`.
    selector:
      'VariableDeclarator[id.typeAnnotation][init.type="ObjectExpression"][init.properties.length>0]',
    message:
      'Use `satisfies` instead of a type annotation for an object literal. `const x = { ... } satisfies Type` preserves narrow types.',
  },
  {
    selector:
      'VariableDeclarator[id.typeAnnotation][init.type="ArrayExpression"][init.elements.length>0]',
    message:
      'Use `satisfies` instead of a type annotation for an array literal. `const x = [ ... ] satisfies Type` preserves narrow types.',
  },
  // NO REDUNDANT TYPE ANNOTATION on `new` expressions — `new Foo()`
  // already returns the typed instance. `const x: Foo = new Foo()`
  // duplicates information. Drop the annotation: `const x = new Foo()`.
  {
    selector: 'VariableDeclarator[id.typeAnnotation][init.type="NewExpression"]',
    message:
      'Redundant type annotation on a `new` expression — the constructor already returns the typed instance. Drop the annotation: `const x = new Foo()` instead of `const x: Foo = new Foo()`.',
  },
];

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: IGNORE_PATTERNS },

  // Base JS rules apply to all source files.
  js.configs.recommended,

  // Typed TypeScript rules apply ONLY to .ts / .mts / .cts files.
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typedFilePatterns,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typedFilePatterns,
  })),

  prettierConfig,

  {
    files: typedFilePatterns,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['e2e/tests/examples/gherkin/payments-system.e2e.spec.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: baseGlobals,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'import-x': importPlugin,
      'unicorn': unicornPlugin,
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      // `prefer-optional-chain` would force `foo?.bar`, but we ban `?.` via
      // `no-restricted-syntax: ChainExpression`. Disable to avoid the conflict.
      '@typescript-eslint/prefer-optional-chain': 'off',
      // `no-useless-default-assignment` would force us to switch `param = undefined`
      // to `param?:`, but we ban `?:` optional parameters. The default-value
      // pattern is the only way to express "can be called with N or N-1 args"
      // without `?:`, so this rule must be disabled.
      '@typescript-eslint/no-useless-default-assignment': 'off',
      // `unified-signatures` would force us to collapse overloads into one
      // signature with `?:` optional params, contradicting the `no ?:` rule.
      // Overloads are the correct way to express multi-arity functions here.
      '@typescript-eslint/unified-signatures': 'off',
      // `no-namespace` bans module-augmenting namespace declarations by default.
      // We need them to extend `declare global { namespace PlaywrightTest { ... } }`
      // with custom matchers. Allow inside `declare` blocks (the only legitimate
      // use case for namespaces in this codebase).
      '@typescript-eslint/no-namespace': [
        'error',
        { allowDeclarations: true, allowDefinitionFiles: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],

      // Import rules
      'import-x/no-cycle': ['error', { maxDepth: 10 }],
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            ...testFilePatterns,
            '**/*.config.ts',
            '**/*.config.mts',
            '**/*.config.mjs',
            '**/*.config.cjs',
            '**/*.config.js',
          ],
          optionalDependencies: false,
          // A peer dependency IS a declaration: testbed declares testcontainers
          // and runner-playwright declares @playwright/test as peers on purpose,
          // so the harness root owns the single copy. Without this the rule
          // treats a correctly declared peer as an undeclared import and pushes
          // toward a duplicate direct dependency, which is the bug the peer
          // declaration exists to prevent.
          peerDependencies: true,
        },
      ],

      // Strict boundary rules
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@suites/*/src/*', '@suites/*/src'],
              message:
                'Import from package entry point, not /src paths. Use @suites/blackbox/<subpath>.',
            },
            {
              group: ['../../../*'],
              message:
                'Avoid deep relative imports. Use workspace package imports.',
            },
          ],
        },
      ],

      // Unicorn rules
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/no-array-reduce': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/filename-case': 'off',

      // General rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      // Keep modules and operations small enough to review as one unit. Large
      // declarative data belongs in JSON/YAML; large workflows must be split
      // into named collaborators instead of accumulating in one function.
      'max-lines': [
        'error',
        { max: 250, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    files: testFilePatterns,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Test files live 2-3 directories deep under test/, so a 3-level
      // relative import is same-package (test/a/b/ → src/). This pattern
      // measures depth, not destination: in this flat layout a cross-package
      // import needs only one or two ".." segments, so 4+ levels mostly
      // catches a deeply nested SAME-package relative import reaching far
      // across its own source tree, not a package boundary. Enforcing that
      // boundary is dependency-cruiser's job (.dependency-cruiser.cjs), not
      // this rule's.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@suites/*/src/*', '@suites/*/src'],
              message:
                'Import from package entry point, not /src paths. Use @suites/blackbox/<subpath>.',
            },
            {
              group: ['../../../../*'],
              message:
                'Avoid deep relative imports. Use a shallower path within the package; dependency-cruiser enforces package boundaries separately.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
      'import-x/no-extraneous-dependencies': 'off',
    },
  },

  // ESM script files (*.mjs). These are Node.js utility scripts, not TypeScript
  // source. Apply Node globals so `console`, `process`, `URL`, etc. are defined.
  {
    files: ['**/*.mjs', '**/bin/*.js'],
    languageOptions: {
      globals: baseGlobals,
    },
    rules: {
      'no-restricted-syntax': ['error', NO_DYNAMIC_IMPORT],
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // CommonJS source files (e.g. packages/blackbox-otel-node/bootstrap.cjs).
  // These run in SUT containers via NODE_OPTIONS=--require, so they can't be
  // ESM and can't be TypeScript. Lint them with vanilla JS rules + Node
  // globals + CommonJS source type. None of the typed TS rules apply.
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: baseGlobals,
    },
    rules: {
      'no-restricted-syntax': ['error', NO_DYNAMIC_IMPORT],
      'no-console': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
    },
  },

  // The user-facing configuration surface. Everything in RESTRICTED_SYNTAX still
  // applies here EXCEPT the optional-property ban, which states the wrong
  // contract for a settings type: `?:` means the user may omit the key, while
  // `T | undefined` means they must write it and pass undefined. See the
  // CONFIG_SURFACE_FILES comment above for the regression this prevents.
  {
    files: CONFIG_SURFACE_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX.filter(
          (rule) => rule.selector !== OPTIONAL_PROPERTY_SELECTOR,
        ),
      ],
    },
  },
];
