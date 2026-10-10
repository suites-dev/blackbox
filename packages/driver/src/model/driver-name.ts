const DRIVER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isDriverName(value: unknown): value is string {
  return typeof value === 'string' && DRIVER_NAME_PATTERN.test(value);
}
