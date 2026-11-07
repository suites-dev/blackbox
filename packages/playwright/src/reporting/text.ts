import { stripVTControlCharacters } from 'node:util';

export const reportTextLimit = 1000;

/** Credential redaction for structured evidence; preserve admitted string data. */
export function redactText(input: string): string {
  return input
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/(\b(?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/giu, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/giu, '$1[REDACTED]@');
}

export function reportText(input: string): string {
  let plain = '';
  for (const character of stripVTControlCharacters(input)) {
    const code = character.codePointAt(0) ?? 0;
    plain += code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }
  return redactText(plain).slice(0, reportTextLimit);
}
