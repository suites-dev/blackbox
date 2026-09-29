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
  process.stdout.write(`${JSON.stringify(document)}\n`);
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
