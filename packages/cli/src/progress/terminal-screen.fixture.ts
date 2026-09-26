import assert from 'node:assert/strict';
import { terminalWidth } from './terminal-text.js';

/** Small terminal emulator for the precise cursor operations owned by the renderer. */
export class TerminalScreen {
  private lines: string[][] = [['u', 's', 'e', 'r', ' ', 'o', 'u', 't', 'p', 'u', 't'], []];
  private row = 1;
  private column = 0;
  private columns: number;
  writes = 0;
  wraps = 0;
  constructor(columns: number) {
    this.columns = columns;
  }

  write(text: string): void {
    this.writes++;
    let offset = 0;
    const escape = String.fromCharCode(27);
    const pattern = new RegExp(`${escape}\\[(\\d*)([A-Za-z])|\\r|\\n|[^${escape}\\r\\n]+`, 'gu');
    for (const token of text.matchAll(pattern)) {
      assert.equal(token.index, offset, 'unsupported terminal escape');
      offset += token[0].length;
      if (token[0].startsWith(escape)) {
        this.escape({ count: Number(token[1] || 1), command: token[2] });
      } else if (token[0] === '\r') {
        this.column = 0;
      } else if (token[0] === '\n') {
        this.row++;
        this.ensureLine();
      } else {
        this.print(token[0]);
      }
    }
    assert.equal(offset, text.length);
  }

  text(): string {
    return this.lines
      .map((line) => line.join('').trimEnd())
      .join('\n')
      .trimEnd();
  }

  resize(columns: number): void {
    const old = this.lines;
    const cursor = { row: this.row, column: this.column };
    this.columns = columns;
    this.lines = [];
    for (const [index, line] of old.entries()) {
      const chunks = Math.max(1, Math.ceil(line.length / columns));
      if (index === cursor.row) {
        this.row = this.lines.length + Math.min(chunks - 1, Math.floor(cursor.column / columns));
        this.column = cursor.column % columns;
      }
      for (let start = 0; start < chunks; start++) {
        this.lines.push(line.slice(start * columns, (start + 1) * columns));
      }
    }
  }

  private escape(input: { readonly count: number; readonly command: string }): void {
    if (input.command === 'm') {
      return;
    }
    if (input.command === 'K') {
      assert.equal(input.count, 2);
      this.lines[this.row] = [];
      return;
    }
    if (input.command === 'A') {
      this.row -= input.count;
      assert.ok(this.row >= 1, 'renderer moved into unrelated output');
      return;
    }
    assert.fail(`unexpected CSI ${input.command}`);
  }

  private print(text: string): void {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
      text,
    )) {
      const width = terminalWidth(segment);
      if (this.column + width > this.columns) {
        this.row++;
        this.column = 0;
        this.wraps++;
      }
      this.ensureLine();
      this.lines[this.row][this.column] = segment;
      for (let index = 1; index < width; index++) {
        this.lines[this.row][this.column + index] = '';
      }
      this.column += width;
    }
  }
  private ensureLine(): void {
    this.lines[this.row] ??= [];
  }
}
