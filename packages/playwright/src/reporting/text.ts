import { stripVTControlCharacters } from 'node:util';

export const reportTextLimit = 1000;

export function reportTextResult(
  input: string,
): { readonly text: string; readonly truncated: boolean } {
  let plain = '';
  for (const character of stripVTControlCharacters(input)) {
    const code = character.codePointAt(0) ?? 0;
    plain += code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }
  const redacted = plain
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/(\b(?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/giu, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/giu, '$1[REDACTED]@');
  return {
    text: redacted.slice(0, reportTextLimit),
    truncated: redacted.length > reportTextLimit,
  };
}

export function reportText(input: string): string {
  return reportTextResult(input).text;
}
