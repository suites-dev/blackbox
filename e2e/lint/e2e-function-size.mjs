const maximumCodeLines = 80;
const suiteCallbacks = new Set([
  'test.system',
  'test.system.sandbox',
  'system.sandbox',
  'sandbox.describe',
  'suite.describe',
]);

function memberName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') {
    return null;
  }
  const object = memberName(node.object);
  return object === null ? null : `${object}.${node.property.name}`;
}

function calleeName(node) {
  const parent = node.parent;
  if (parent?.type !== 'CallExpression' || parent.arguments.at(-1) !== node) {
    return null;
  }
  return memberName(parent.callee);
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
