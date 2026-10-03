import { get } from 'node:http';

export function parseParallelBarrierPort(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d{0,4}$/u.test(value)) {
    throw new Error('Parallel rendezvous port must be an integer from 1 through 65535');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('Parallel rendezvous port must be an integer from 1 through 65535');
  }
  return port;
}

export async function joinParallelBarrier(): Promise<void> {
  const port = parseParallelBarrierPort(process.env.BLACKBOX_PARALLEL_BARRIER_PORT);
  await new Promise<void>((resolveJoin, rejectJoin) => {
    const request = get(
      {
        hostname: '127.0.0.1',
        method: 'GET',
        path: '/arrive',
        port,
        protocol: 'http:',
      },
      (response) => {
        response.once('error', rejectJoin);
        response.once('end', () => {
          if (response.statusCode === 204) {
            resolveJoin();
          } else {
            rejectJoin(
              new Error(`Parallel rendezvous failed with HTTP ${response.statusCode ?? 'missing'}`),
            );
          }
        });
        response.resume();
      },
    );
    request.once('error', rejectJoin);
  });
}
