const DRIVER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isDriverName(value: string): boolean {
  return DRIVER_NAME_PATTERN.test(value);
}
