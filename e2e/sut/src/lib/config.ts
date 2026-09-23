export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function servicePort(defaultPort = 3000): number {
  const value = Number(process.env.PORT ?? defaultPort);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('PORT must be an integer from 1 through 65535');
  }
  return value;
}
