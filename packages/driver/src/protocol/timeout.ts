export const driverPreparationTimeoutMs = 5_000;

export class DriverPreparationTimeoutError extends Error {
  constructor() {
    super(`Driver preparation exceeded ${driverPreparationTimeoutMs}ms`);
    this.name = 'DriverPreparationTimeoutError';
  }
}

export async function withDriverPreparationTimeout<T>(operation: Promise<T>): Promise<T> {
  let rejectExpiry = (_error: Error): void => {
    return undefined;
  };
  const expiry = new Promise<never>((_resolve, reject) => {
    rejectExpiry = reject;
  });
  const timeout = setTimeout(
    () => {
      rejectExpiry(new DriverPreparationTimeoutError());
    },
    driverPreparationTimeoutMs,
  );
  try {
    return await Promise.race([operation, expiry]);
  } finally {
    clearTimeout(timeout);
  }
}
