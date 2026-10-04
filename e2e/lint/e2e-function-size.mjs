const maximumCodeLines = 80;
const suiteCallbacks = new Set(['test.system', 'system.sandbox', 'sandbox.describe']);

function calleeName(node) {
  const parent = node.parent;
  if (
    parent?.type !== 'CallExpression' ||
    parent.arguments.at(-1) !== node ||
    parent.callee.type !== 'MemberExpression' ||
    parent.callee.computed ||
    parent.callee.object.type !== 'Identifier' ||
    parent.callee.property.type !== 'Identifier'
  ) {
    return null;
  }
  return `${parent.callee.object.name}.${parent.callee.property.name}`;
}

function isSuiteDeclaration(node) {
  return !node.async && suiteCallbacks.has(calleeName(node));
}

function coveredLines(sourceCode, node) {
  const lines = new Set();
  for (const token of sourceCode.getTokens(node)) {
    for (let line = token.loc.start.line; line <= token.loc.end.line; line++) {
      lines.add(line);
    }
  }
  return lines.size;
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Limit executable E2E functions while allowing synchronous Blackbox suite declarations.',
    },
    schema: [],
    messages: {
      oversized:
        'Executable function has {{lines}} code-token lines. Maximum allowed is {{maximum}}.',
    },
  },
  create(context) {
    const inspect = (node) => {
      if (isSuiteDeclaration(node)) {
        return;
      }
      const lines = coveredLines(context.sourceCode, node);
      if (lines > maximumCodeLines) {
        context.report({
          node,
          messageId: 'oversized',
          data: { lines, maximum: maximumCodeLines },
        });
      }
    };
    return {
      ArrowFunctionExpression: inspect,
      FunctionDeclaration: inspect,
      FunctionExpression: inspect,
    };
  },
};

export default rule;
