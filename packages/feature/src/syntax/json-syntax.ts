/** Reports invalid JSON for the vocabulary's pure checks, outside step bodies. */
export function jsonSyntaxError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
