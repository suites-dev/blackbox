const clientNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isClientName(value: string): boolean {
  return clientNamePattern.test(value);
}
