import { requiredEnvironment, servicePort } from '../lib/config.js';
import { closeServer, startJsonServer } from '../lib/http.js';
import { writeError } from '../lib/log.js';
import { createPaymentMock } from './app.js';

async function main(): Promise<void> {
  const server = await startJsonServer(
    servicePort(8080),
    createPaymentMock(requiredEnvironment('FIXTURE_CONTROL_TOKEN')),
  );
  const shutdown = async (): Promise<void> => {
    await closeServer(server);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = 1;
});
