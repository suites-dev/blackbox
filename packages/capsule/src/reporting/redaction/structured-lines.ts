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

export function redactStructuredLines(
  input: string, plain: (s: string) => string, fields: (s: string) => string, header: RegExp,
): string {
  if (isStructured(input)) {
    return redactJson(input, plain, fields);
  }
  let offset = 0;
  const parts: string[] = [];
  // An indented JSON record is valid JSON-lines, except when that same line is the
  // continuation of a plaintext sensitive header. Preserve this boundary across CRLF.
  let inHeader = false;
  for (const match of input.matchAll(/([^\r\n]*)(?:\r\n?|\n|$)/gu)) {
    const line = match[1];
    const folded: boolean = inHeader && /^[\t ]/u.test(line);
    if (!folded && isStructured(line)) {
      parts.push(plain(input.slice(offset, match.index)), redactJson(line, plain, fields));
      offset = match.index + line.length;
      inHeader = false;
    } else {
      inHeader = folded || line.search(header) !== -1;
    }
  }
  return parts.length === 0 ? plain(input) : parts.join('') + plain(input.slice(offset));
}
