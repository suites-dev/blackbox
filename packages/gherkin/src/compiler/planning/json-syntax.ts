/**
 * Why `text` is not JSON, or null when it is. The step library's compile-time
 * checks report it; it lives with the compiler because library code may not
 * catch an error (hard rule 4).
 */
export function jsonSyntaxError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
