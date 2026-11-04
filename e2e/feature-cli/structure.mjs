import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

function transformSuite(source, environmentSources, inert) {
  const file = ts.createSourceFile('suite.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, 'Suite is not valid TypeScript');
  let steps = 0;
  const transformed = ts.transform(file, [
    (context) => {
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'test' &&
          node.expression.name.text === 'use' &&
          Object.keys(environmentSources).length > 0
        ) {
          const options = node.arguments[0];
          assert.ok(
            ts.isObjectLiteralExpression(options),
            'Scaffold test.use needs literal options',
          );
          const properties = options.properties.map((property) => {
            if (!ts.isPropertyAssignment(property) || property.name.getText(file) !== 'blackbox')
              return property;
            assert.ok(
              ts.isObjectLiteralExpression(property.initializer),
              'Scaffold blackbox needs literal options',
            );
            assert.ok(
              !property.initializer.properties.some(
                (item) => item.name?.getText(file) === 'environment',
              ),
              'Scaffold must not overwrite an existing environment',
            );
            const environment = ts.factory.createObjectLiteralExpression(
              Object.entries(environmentSources).map(([name, source]) =>
                ts.factory.createPropertyAssignment(
                  ts.factory.createStringLiteral(name),
                  ts.factory.createElementAccessExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier('process'),
                      'env',
                    ),
                    ts.factory.createStringLiteral(source),
                  ),
                ),
              ),
            );
            return ts.factory.updatePropertyAssignment(
              property,
              property.name,
              ts.factory.updateObjectLiteralExpression(property.initializer, [
                ...property.initializer.properties,
                ts.factory.createPropertyAssignment('environment', environment),
              ]),
            );
          });
          return ts.factory.updateCallExpression(node, node.expression, undefined, [
            ts.factory.updateObjectLiteralExpression(options, properties),
          ]);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'step'
        ) {
          assert.equal(node.arguments.length, 2, 'Unexpected step signature');
          steps += 1;
          if (!inert) return node;
          return ts.factory.updateCallExpression(node, node.expression, undefined, [
            node.arguments[0],
            ts.factory.createArrowFunction(
              [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
              undefined,
              [],
              undefined,
              undefined,
              ts.factory.createBlock([], true),
            ),
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      }
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const code = ts.createPrinter().printFile(transformed.transformed[0]);
  transformed.dispose();
  assert.ok(steps > 0, 'Suite has no step closures');
  return code;
}

/** Collect complete test, hook, and step callbacks independently of printed formatting. */
export function businessCallbacks(source) {
  const file = ts.createSourceFile('suite.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, 'Suite is not valid TypeScript');
  const callbacks = [];
  function semantic(node) {
    if (ts.isParenthesizedExpression(node)) return semantic(node.expression);
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(semantic(child));
    });
    return [
      ts.SyntaxKind[node.kind],
      typeof node.text === 'string' ? node.text : null,
      ...children,
    ];
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '';
      if (
        ['test', 'step', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'stimulus'].includes(
          name,
        )
      ) {
        const callback = node.arguments.at(-1);
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          callbacks.push({ kind: name, body: semantic(callback) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(callbacks.length > 0, 'Suite has no business callbacks');
  return callbacks;
}

/** Prepare runnable generated source by changing only the complete blackbox environment option. */
export function executionSuite(source, environmentSources = {}) {
  const code = transformSuite(source, environmentSources, false);
  assert.deepEqual(
    businessCallbacks(code),
    businessCallbacks(source),
    'Execution suite changed generated business callbacks',
  );
  return code;
}

/** Structural inspection only: never run the resulting empty callbacks as acceptance tests. */
export function skeleton(source, environmentSources = {}) {
  return transformSuite(source, environmentSources, true);
}

function rowTitle(title) {
  let match = /^Scenario: (.+) \[Examples (\d+): (.+), row (\d+)\]$/u.exec(title);
  if (match)
    return { title: `Scenario: ${match[1]}`, example: `${match[2]}:${match[3]}:${match[4]}` };
  match = /^Examples (\d+): (.+) \/ row (\d+): (.+)$/u.exec(title);
  return match
    ? { title: `Scenario: ${match[4]}`, example: `${match[1]}:${match[2]}:${match[3]}` }
    : { title };
}

function selectionInCatalog(selection, catalog) {
  if (catalog.length === 0) return selection;
  const id = typeof selection === 'string' ? selection : selection.id;
  const entry = catalog.find((candidate) => candidate.id === id);
  assert.ok(entry, `Unknown catalog selection ${id}`);
  if (typeof selection !== 'string') {
    assert.equal(selection.kind, entry.kind, `Catalog kind mismatch for ${id}`);
  }
  return { kind: entry.kind, id: entry.id };
}

/** Execute trusted repository declaration code with inert native declaration recorders. */
export async function structure(source, catalog = []) {
  const file = ts.createSourceFile('skeleton.ts', skeleton(source), ts.ScriptTarget.Latest, true);
  const bindings = {};
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    for (const element of statement.importClause?.namedBindings?.elements ?? [])
      bindings[element.name.text] = {};
  }
  const body = ts.factory.updateSourceFile(
    file,
    file.statements.filter((node) => !ts.isImportDeclaration(node)),
  );
  const code = ts.transpileModule(ts.createPrinter().printFile(body), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const cases = [];
  let scope = { path: [], tags: [], hooks: [] };
  function scoped(patch, callback) {
    const parent = scope;
    scope = { ...scope, ...patch };
    try {
      callback();
    } finally {
      scope = parent;
    }
  }
  const test = (title, ...args) => {
    cases.push({
      ...scope,
      rawTitle: title,
      ...rowTitle(title),
      callback: args.at(-1),
      tags: [...scope.tags, ...(args[0]?.tag ?? [])],
    });
  };
  test.describe = (title, ...args) => {
    scoped(
      {
        path: [...scope.path, title],
        tags: [...scope.tags, ...(args[0]?.tag ?? [])],
        hooks: [...scope.hooks],
      },
      args.at(-1),
    );
  };
  test.beforeEach = (title, callback) => {
    scope.hooks.push({ title, callback });
  };
  test.use = ({ blackbox }) => {
    // Native option values replace the complete preceding object at this scope.
    scope.selection = selectionInCatalog(blackbox.system, catalog);
    scope.environment = blackbox.environment ?? {};
    scope.clients = Object.keys(blackbox.clients ?? {}).sort();
  };
  vm.runInNewContext(
    code,
    {
      ...bindings,
      test,
      process: { env: new Proxy({}, { get: (_target, name) => `<environment:${String(name)}>` }) },
    },
    { timeout: 1000 },
  );
  const result = [];
  for (const item of cases) {
    const steps = [];
    const fixtures = {
      clients: {},
      step: async (title) => {
        steps.push(title);
      },
    };
    const backgrounds = [];
    for (const hook of item.hooks) {
      const start = steps.length;
      await hook.callback(fixtures);
      backgrounds.push({ title: hook.title, steps: steps.splice(start) });
    }
    await item.callback(fixtures);
    const { callback: _callback, hooks: _hooks, rawTitle: _rawTitle, ...declaration } = item;
    result.push({
      ...declaration,
      path: item.path.filter((title) => !title.startsWith('Examples: ')),
      backgrounds,
      steps,
    });
  }
  return JSON.parse(JSON.stringify(result));
}

export async function compareStructure(generated, handAuthored, catalog = []) {
  const actual = await structure(generated, catalog);
  assert.deepEqual(
    actual,
    await structure(handAuthored, catalog),
    'Generated declaration/step-title structure differs from the hand-authored suite',
  );
  assert.ok(actual.length > 0, 'Structural comparison found no scenarios');
  return actual;
}
