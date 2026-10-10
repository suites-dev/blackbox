import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A loopback stand-in that answers each path with one fixed JSON body, for
// response claims on bodies the subscription stub does not produce. Each body
// is written as the system under test would send it.

export interface AnswerSystem {
  readonly url: string;
  readonly close: () => Promise<void>;
}

export interface Answer {
  readonly status: number;
  readonly body: string;
}

export async function startAnswerSystem(
  answers: Readonly<Record<string, Answer>>,
): Promise<AnswerSystem> {
  const server: Server = createServer((request, response) => {
    request.resume();
    const path = request.url ?? '/';
    const answer = Object.hasOwn(answers, path)
      ? answers[path]
      : { status: 404, body: '{"error": "not-found"}' };
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}
