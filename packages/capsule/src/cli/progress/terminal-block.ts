import { clipTerminalText, terminalWidth } from './terminal-text.js';

export interface TerminalViewport {
  readonly columns: number;
  readonly rows: number;
}
export interface TerminalLine {
  readonly text: string;
  readonly tone: 'active' | 'success' | 'failure' | 'neutral';
}
export interface TerminalBlockInput {
  readonly write: (text: string) => void;
  readonly viewport: () => TerminalViewport;
  readonly color: boolean;
}
const ESC = '\u001b[';

/** Owns only the lines it rendered, ending each draw on its last owned line. */
export class TerminalBlock {
  private widths: readonly number[] = [];
  private finished = false;
  constructor(private readonly input: TerminalBlockInput) {}

  render(input: { readonly lines: readonly TerminalLine[] }): void {
    if (this.finished) {
      return;
    }
    const viewport = this.input.viewport();
    const columns = Math.max(2, Math.floor(viewport.columns));
    const rows = Math.max(2, Math.floor(viewport.rows));
    const capacity = Math.max(1, rows - 1);
    const limited =
      capacity === 1
        ? input.lines.slice(0, 1)
        : input.lines.length <= capacity
          ? input.lines
          : [
              ...input.lines.slice(0, Math.max(0, capacity - 1)),
              {
                text: `  … ${input.lines.length - capacity + 1} more steps retained in the report`,
                tone: 'neutral' as const,
              },
            ];
    const lines = limited.map((line) => ({
      ...line,
      text: clipTerminalText({ text: line.text, columns: columns - 1 }),
    }));
    // A narrower terminal can reflow the previous frame before our next draw.
    const previousRows = Math.min(
      rows,
      this.widths.reduce((count, width) => count + Math.max(1, Math.ceil(width / columns)), 0),
    );
    const targetRows = Math.max(1, lines.length);
    const height = Math.max(previousRows, targetRows);
    let output = '\r';
    if (previousRows > 1) {
      output += `${ESC}${previousRows - 1}A`;
    }
    for (let index = 0; index < height; index++) {
      output += `${ESC}2K`;
      if (index < lines.length) {
        output += this.paint(lines[index]);
      }
      if (index < height - 1) {
        output += '\r\n';
      }
    }
    if (height > targetRows) {
      output += `${ESC}${height - targetRows}A\r`;
    }
    this.input.write(output);
    this.widths = lines.map((line) => terminalWidth(line.text));
  }

  finish(): void {
    if (this.finished) {
      return;
    }
    if (this.widths.length > 0) {
      this.input.write('\r\n');
    }
    this.finished = true;
  }

  private paint(line: TerminalLine): string {
    if (!this.input.color) {
      return line.text;
    }
    const colors = { active: 36, success: 32, failure: 31, neutral: 2 };
    return `${ESC}${colors[line.tone]}m${line.text}${ESC}0m`;
  }
}
