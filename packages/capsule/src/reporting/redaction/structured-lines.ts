const jsonString = /"(?:\\.|[^"\\])*"(\s*:)?/gu;

function isStructured(value: string): boolean {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Preserve numeric literals, whitespace, duplicate keys, and unchanged escapes verbatim. */
function redactJson(text: string, plain: (s: string) => string, fields: (s: string) => string): string {
  return fields(text).replace(jsonString, (token: string, keySuffix: string | undefined) => {
    if (keySuffix !== undefined) {
      return token;
    }
    const decoded = JSON.parse(token) as string;
    const redacted = plain(decoded);
    return redacted === decoded ? token : JSON.stringify(redacted);
  });
}

export function redactStructuredLines(input: string, plain: (s: string) => string, fields: (s: string) => string): string {
  if (isStructured(input)) {
    return redactJson(input, plain, fields);
  }
  let offset = 0;
  const parts: string[] = [];
  // Keep plain header lines and their indented continuations together.
  for (const match of input.matchAll(/^[{[][^\r\n]*[}\]][\t ]*(?=\r?$)/gmu)) {
    if (isStructured(match[0])) {
      parts.push(plain(input.slice(offset, match.index)), redactJson(match[0], plain, fields));
      offset = match.index + match[0].length;
    }
  }
  return parts.length === 0 ? plain(input) : parts.join('') + plain(input.slice(offset));
}
