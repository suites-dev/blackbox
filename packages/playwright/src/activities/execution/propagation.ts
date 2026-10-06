export type HeaderMap = Readonly<Record<string, string>>;

function canonicalNames(headers: HeaderMap): ReadonlySet<string> {
  return new Set(Object.keys(headers).map((name) => name.toLowerCase()));
}

/** Caller headers are preserved except for case-insensitive canonical W3C fields. */
export function mergeActivityHeaders(
  existing: HeaderMap,
  canonical: HeaderMap,
): Readonly<Record<string, string>> {
  const protectedNames = canonicalNames(canonical);
  return Object.freeze({
    ...Object.fromEntries(
      Object.entries(existing).filter(([name]) => !protectedNames.has(name.toLowerCase())),
    ),
    ...canonical,
  });
}

/** Remove only values injected by this activity; unrelated caller trace headers survive. */
export function removeInjectedActivityHeaders(
  existing: HeaderMap,
  canonical: HeaderMap,
): Readonly<Record<string, string>> {
  const injected = new Map(
    Object.entries(canonical).map(([name, value]) => [name.toLowerCase(), value] as const),
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(existing).filter(
        ([name, value]) => injected.get(name.toLowerCase()) !== value,
      ),
    ),
  );
}
