function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function environmentEntries(inspection: unknown): readonly unknown[] {
  if (!isRecord(inspection) || !isRecord(inspection.Config)) {
    throw new Error('Docker container inspection is missing Config');
  }
  const environment = inspection.Config.Env;
  if (!Array.isArray(environment)) {
    throw new Error('Docker container inspection Config.Env must be an array');
  }
  return environment;
}

function parseEnvironmentEntry(entry: unknown, index: number): readonly [string, string] {
  if (typeof entry !== 'string') {
    throw new Error('Docker container inspection Config.Env entries must be strings');
  }
  const separator = entry.indexOf('=');
  if (separator <= 0) {
    throw new Error(`Malformed Docker container environment entry at index ${index}`);
  }
  return [entry.slice(0, separator), entry.slice(separator + 1)];
}

/** Duplicate keys use the final Docker Config.Env entry, matching process environment materialization. */
export function snapshotContainerEnvironment(
  inspection: unknown,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    environmentEntries(inspection).map((entry, index) => parseEnvironmentEntry(entry, index)),
  ));
}
