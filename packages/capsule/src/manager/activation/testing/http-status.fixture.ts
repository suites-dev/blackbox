import { once } from 'node:events';
import { createServer } from 'node:http';

export async function collectorStatusServer(input: {
  readonly body: string;
  readonly status: number;
}) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(input.status, { 'content-type': 'application/json' }).end(input.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected collector status TCP endpoint');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { requests,
    telemetry: { kind: 'available' as const, endpoints: { baseUrl,
      tracesUrl: `${baseUrl}/traces`, activationUrl: `${baseUrl}/activation`,
      readUrl: `${baseUrl}/status` } },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) { reject(error); } else { resolve(); } });
      });
    },
  };
}
