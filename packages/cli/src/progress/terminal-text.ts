import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Terminal data is text: neither retained names nor errors may move the cursor. */
export function terminalText(value: string): string {
  let result = '';
  for (const character of stripVTControlCharacters(value)) {
    const code = character.codePointAt(0) ?? 0;
    result += code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }
  return result;
}

export function terminalWidth(text: string): number {
  return stringWidth(terminalText(text));
}

export function clipTerminalText(input: { readonly text: string; readonly columns: number }): string {
  const text = terminalText(input.text);
  if (terminalWidth(text) <= input.columns) { return text; }
  if (input.columns <= 0) { return ''; }
  let used = 0;
  let result = '';
  for (const item of graphemes.segment(text)) {
    const width = stringWidth(item.segment);
    if (used + width > input.columns - 1) { break; }
    result += item.segment;
    used += width;
  }
  return `${result}…`;
}
