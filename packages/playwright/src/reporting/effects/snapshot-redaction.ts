/** The effects YAML encoder quotes every string as a JSON token. Redact values without editing YAML punctuation. */
export function redactEffectSnapshot(yaml: string, redact: (text: string) => string): string {
  return yaml.replace(/"(?:[^"\\]|\\.)*"/gu, (token) => {
    const decoded: unknown = JSON.parse(token);
    if (typeof decoded !== 'string') { throw new TypeError('Expected a quoted effect snapshot string'); }
    return JSON.stringify(redact(decoded)).replace(/[\u0085\u2028\u2029]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  });
}
