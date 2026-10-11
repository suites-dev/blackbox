import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

/** Preserve declarations and step titles; never execute the generated business closures. */
export function skeleton(source) {
  const file = ts.createSourceFile('suite.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, 'Suite is not valid TypeScript');
  let steps = 0;
  const transformed = ts.transform(file, [
    (context) => {
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'step'
        ) {
          assert.equal(node.arguments.length, 2, 'Unexpected step signature');
          steps += 1;
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

function rowTitle(title) {
  let match = /^Scenario: (.+) \[Examples (\d+): (.+), row (\d+)\]$/u.exec(title);
  if (match)
    return { title: `Scenario: ${match[1]}`, example: `${match[2]}:${match[3]}:${match[4]}` };
  match = /^Examples (\d+): (.+) \/ row (\d+): (.+)$/u.exec(title);
  return match
    ? { title: `Scenario: ${match[4]}`, example: `${match[1]}:${match[2]}:${match[3]}` }
    : { title };
}

/** Execute trusted repository declaration code with an inert recording facade, not Playwright. */
export async function structure(source) {
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
  const suite = {
    describe(title, ...args) {
      scoped(
        {
          path: [...scope.path, title],
          tags: [...scope.tags, ...(args[0]?.tag ?? [])],
          hooks: [...scope.hooks],
        },
        args.at(-1),
      );
    },
    beforeEach(title, callback) {
      scope.hooks.push({ title, callback });
    },
    test(title, ...args) {
      cases.push({
        ...scope,
        rawTitle: title,
        ...rowTitle(title),
        callback: args.at(-1),
        tags: [...scope.tags, ...(args[0]?.tag ?? [])],
      });
    },
  };
  const test = {
    system(selection, callback) {
      if (typeof selection === 'string') selection = { kind: 'system', id: selection };
      scoped({ selection }, () =>
        callback({
          sandbox(name, options, callback) {
            scoped({ sandbox: name, clients: Object.keys(options.clients).sort() }, () =>
              callback(suite),
            );
          },
        }),
      );
    },
  };
  vm.runInNewContext(code, { ...bindings, test }, { timeout: 1000 });
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

export async function compareStructure(generated, handAuthored) {
  const actual = await structure(generated);
  assert.deepEqual(
    actual,
    await structure(handAuthored),
    'Generated declaration/step-title structure differs from the hand-authored suite',
  );
  assert.ok(actual.length > 0, 'Structural comparison found no scenarios');
  return actual;
}
