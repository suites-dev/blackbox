/**
 * Output channels. Human Blackbox lines always go to stderr so stdout carries
 * only child output (run) or exactly one JSON document (--json).
 */
export function writeHuman(lines: readonly string[]): void {
  if (lines.length > 0) {
    process.stderr.write(`${lines.join('\n')}\n`);
  }
}

export function writeJson(document: unknown): void {
  process.stdout.write(`${stackSafeJsonStringify(document)}\n`);
}

type JsonFrame =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'array'; readonly value: readonly unknown[]; index: number }
  | { readonly kind: 'object'; readonly value: Record<string, unknown>; readonly keys: readonly string[]; index: number };

/** JSON.stringify's recursive walk can overflow on a deeply nested trace tree. */
// eslint-disable-next-line complexity -- mirrors JSON.stringify's per-type cases (primitive, unsupported, circular, array, object) inside one explicit-stack loop, which is what avoids recursion
function stackSafeJsonStringify(value: unknown): string {
  const output: string[] = [];
  const active = new Set<object>();
  const stack: JsonFrame[] = [];
  stack.push({ kind: 'value', value });
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }
    if (frame.kind === 'value') {
      if (frame.value === null || typeof frame.value !== 'object') {
        if (
          frame.value === undefined ||
          typeof frame.value === 'function' ||
          typeof frame.value === 'symbol'
        ) {
          output.push('null');
        } else {
          output.push(JSON.stringify(frame.value));
        }
        continue;
      }
      if (active.has(frame.value)) {
        throw new TypeError('Converting circular structure to JSON');
      }
      active.add(frame.value);
      if (Array.isArray(frame.value)) {
        output.push('[');
        stack.push({ kind: 'array', value: frame.value, index: 0 });
      } else {
        const object = frame.value as Record<string, unknown>;
        output.push('{');
        stack.push({
          kind: 'object',
          value: object,
          keys: Object.keys(object).filter((key) => {
            const entry = object[key];
            return entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol';
          }),
          index: 0,
        });
      }
      continue;
    }
    if (frame.kind === 'array') {
      if (frame.index >= frame.value.length) {
        output.push(']');
        active.delete(frame.value);
        continue;
      }
      if (frame.index > 0) {
        output.push(',');
      }
      const valueAtIndex = frame.value[frame.index];
      frame.index += 1;
      stack.push(frame);
      stack.push({ kind: 'value', value: valueAtIndex });
      continue;
    }
    if (frame.index >= frame.keys.length) {
      output.push('}');
      active.delete(frame.value);
      continue;
    }
    if (frame.index > 0) {
      output.push(',');
    }
    const key = frame.keys[frame.index];
    frame.index += 1;
    output.push(JSON.stringify(key), ':');
    stack.push(frame);
    stack.push({ kind: 'value', value: frame.value[key] });
  }
  return output.join('');
}

/** Formats a wall-clock duration for human lines, e.g. `850ms` or `12.4s`. */
export function formatDuration(milliseconds: number): string {
  const rounded = Math.max(0, Math.round(milliseconds));
  return rounded < 1000 ? `${String(rounded)}ms` : `${(rounded / 1000).toFixed(1)}s`;
}

/**
 * Lays out rows as columns sized to content, two spaces apart, with no
 * trailing spaces. Cells missing from a short row are simply omitted.
 */
export function formatColumns(rows: readonly (readonly string[])[]): readonly string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}
