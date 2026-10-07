import type { StepArgument, StepValue } from '../outline.js';

// TypeScript literals for rendered suites. Strings are single-quoted, as a
// person would write them, with every character that could end the literal
// or the line escaped.

const ESCAPES = new Map([
  ['\\', '\\\\'],
  ["'", "\\'"],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\u2028', '\\u2028'],
  ['\u2029', '\\u2029'],
]);

export function quote(text: string): string {
  return `'${text.replace(/[\\'\n\r\u2028\u2029]/gu, (char) => ESCAPES.get(char) ?? char)}'`;
}

export function valueLiteral(value: StepValue): string {
  return typeof value === 'number' ? String(value) : quote(value);
}

export function valuesLiteral(values: readonly StepValue[]): string {
  return `[${values.map(valueLiteral).join(', ')}]`;
}

export function argumentLiteral(argument: StepArgument): string {
  switch (argument.kind) {
    case 'none':
      return "{ kind: 'none' }";
    case 'doc-string': {
      const mediaType = argument.mediaType === null ? 'null' : quote(argument.mediaType);
      return `{ kind: 'doc-string', content: ${quote(argument.content)}, mediaType: ${mediaType} }`;
    }
    case 'data-table': {
      const rows = argument.rows.map((row) => `[${row.map(quote).join(', ')}]`);
      return `{ kind: 'data-table', rows: [${rows.join(', ')}] }`;
    }
  }
}

/** Indents every non-empty line of `text` by `depth` levels of two spaces. */
export function indent(text: string, depth: number): string {
  const pad = '  '.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `${pad}${line}`))
    .join('\n');
}
