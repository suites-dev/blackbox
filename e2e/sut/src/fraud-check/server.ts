import { servicePort } from '../lib/config.js';
import { createDatabasePool } from '../lib/database.js';
import { closeServer, startJsonServer } from '../lib/http.js';
import { writeError } from '../lib/log.js';
import { retry } from '../lib/retry.js';
import { createFraudCheck } from './app.js';
import { FraudAssessmentService } from './assessment.js';
import { FraudAuditRepository } from './repository.js';

async function main(): Promise<void> {
  const pool = createDatabasePool();
  const repository = new FraudAuditRepository(pool);
  await retry('postgres', () => repository.ready());
  const server = await startJsonServer(
    servicePort(),
    createFraudCheck({
      assessment: new FraudAssessmentService(repository),
      ready: () => repository.ready(),
    }),
  );
  const shutdown = async (): Promise<void> => {
    await closeServer(server);
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = 1;
});
