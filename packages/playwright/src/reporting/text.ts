import { stripVTControlCharacters } from 'node:util';

export function reportText(input: string): string {
  let plain = '';
  for (const character of stripVTControlCharacters(input)) {
    const code = character.codePointAt(0) ?? 0;
    plain += code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }
  return plain
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/(\b(?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/giu, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/giu, '$1[REDACTED]@')
    .slice(0, 1000);
}
