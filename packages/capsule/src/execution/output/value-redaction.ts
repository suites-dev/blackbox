const MASK = '[REDACTED]';

export function redactValues(text: string, values: readonly string[]): string {
  const pattern = valuePattern(values);
  return pattern === null ? text : text.replace(pattern, () => MASK);
}

function valuePattern(values: readonly string[]): RegExp | null {
  const alternatives = [...new Set(values.filter((value) => value !== ''))]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return alternatives.length === 0 ? null : new RegExp(alternatives.join('|'), 'gu');
}

export function createStreamingValueRedactor(values: readonly string[]): {
  readonly append: (text: string) => string;
  readonly finish: () => string;
} {
  const pattern = valuePattern(values);
  const lookahead = Math.max(0, ...values.map((value) => value.length - 1));
  let pending = '';
  function consume(limit: number): string {
    const previous = pending.codePointAt(limit - 1);
    const safeLimit = previous !== undefined && previous > 0xffff ? limit - 1 : limit;
    let cursor = 0;
    let output = '';
    if (pattern !== null) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(pending); match !== null; match = pattern.exec(pending)) {
        if (match.index >= safeLimit) {
          break;
        }
        output += pending.slice(cursor, match.index) + MASK;
        cursor = match.index + match[0].length;
      }
    }
    const consumed = Math.max(cursor, safeLimit);
    output += pending.slice(cursor, consumed);
    pending = pending.slice(consumed);
    return output;
  }
  return {
    append(text) {
      pending += text;
      return consume(Math.max(0, pending.length - lookahead));
    },
    finish: () => consume(pending.length),
  };
}
