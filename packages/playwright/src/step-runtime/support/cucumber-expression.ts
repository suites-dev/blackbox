// The subset of Cucumber Expressions the step library is written in: literal
// text, the {int}, {string} and {word} parameter types, and optional text such
// as `item(s)`. Patterns and value conversion are Cucumber's own built-ins, so
// a sentence matches here exactly when @cucumber/cucumber-expressions matches
// it. Anything outside the subset (alternation, other parameter types) is
// refused when the library is built, never matched differently.

/** A parameter type as plain data: its name in braces and the regular expression its text matches. */
export interface SentenceParameterType {
  readonly name: string;
  readonly pattern: string;
}

interface BuiltInType extends SentenceParameterType {
  readonly convert: (text: string) => unknown;
}

const STRING_PATTERN = String.raw`"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'`;
const STRING_TEXT = new RegExp(`^(?:${STRING_PATTERN})$`, 'u');

function unquote(text: string): string {
  const match = STRING_TEXT.exec(text);
  // A string quoted with " fills group 1, one quoted with ' fills group 3.
  const groups: readonly (string | undefined)[] = match ?? [];
  const inner = groups[1] ?? groups[3] ?? '';
  return inner.replace(/\\"/gu, '"').replace(/\\'/gu, "'");
}

const BUILT_IN_TYPES = new Map<string, BuiltInType>(
  [
    { name: 'int', pattern: String.raw`(?:-?\d+)|(?:\d+)`, convert: Number },
    { name: 'string', pattern: STRING_PATTERN, convert: unquote },
    { name: 'word', pattern: String.raw`[^\s]+`, convert: (text: string) => text },
  ].map((type) => [type.name, type]),
);

const REGEX_SPECIAL = /[\\^[({$.|?*+})\]]/gu;

export interface CompiledExpression {
  readonly expression: string;
  readonly parameterTypes: readonly SentenceParameterType[];
  /** The converted parameter values, in order, or null when `text` is not this expression. */
  readonly match: (text: string) => readonly unknown[] | null;
}

interface Parsed {
  readonly source: string;
  readonly types: readonly BuiltInType[];
}

function refuse(expression: string, reason: string): never {
  throw new Error(`Step expression ${JSON.stringify(expression)} ${reason}`);
}

function parameterAt(
  expression: string,
  start: number,
): { readonly type: BuiltInType; readonly end: number } {
  const end = expression.indexOf('}', start);
  if (end === -1) {
    refuse(expression, 'has an unclosed {');
  }
  const name = expression.slice(start + 1, end);
  const type = BUILT_IN_TYPES.get(name);
  if (type === undefined) {
    refuse(expression, `uses parameter type {${name}}, which the step library does not support`);
  }
  return { type, end };
}

function optionalAt(
  expression: string,
  start: number,
): { readonly text: string; readonly end: number } {
  const end = expression.indexOf(')', start);
  const text = expression.slice(start + 1, end);
  if (end === -1 || /[{}()/\\]/u.test(text)) {
    refuse(expression, 'has optional text the step library does not support');
  }
  return { text, end };
}

function parse(expression: string): Parsed {
  let source = '';
  const types: BuiltInType[] = [];
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === '{') {
      const { type, end } = parameterAt(expression, index);
      source += `(${type.pattern.includes('|') ? `(?:${type.pattern})` : type.pattern})`;
      types.push(type);
      index = end;
    } else if (char === '(') {
      const { text, end } = optionalAt(expression, index);
      source += `(?:${text.replace(REGEX_SPECIAL, String.raw`\$&`)})?`;
      index = end;
    } else if (char === '/' || char === '\\' || char === '}' || char === ')') {
      refuse(expression, `uses ${JSON.stringify(char)}, which the step library does not support`);
    } else {
      source += char.replace(REGEX_SPECIAL, String.raw`\$&`);
    }
  }
  return { source, types };
}

/** Numbers the outermost group of each parameter, skipping the groups inside its pattern. */
function parameterGroups(types: readonly BuiltInType[]): readonly number[] {
  const groups: number[] = [];
  let next = 1;
  for (const type of types) {
    groups.push(next);
    // An empty match of `pattern|` holds one entry per group in the pattern, plus the whole match.
    const inner = new RegExp(`(?:${type.pattern})|`, 'u').exec('');
    next += 1 + (inner === null ? 0 : inner.length - 1);
  }
  return groups;
}

export function compileExpression(expression: string): CompiledExpression {
  const { source, types } = parse(expression);
  const regexp = new RegExp(`^${source}$`, 'u');
  const groups = parameterGroups(types);
  return {
    expression,
    parameterTypes: types.map(({ name, pattern }) => ({ name, pattern })),
    match: (text) => {
      const match = regexp.exec(text);
      if (match === null) {
        return null;
      }
      return types.map((type, index) => type.convert(match[groups[index]] ?? ''));
    },
  };
}
