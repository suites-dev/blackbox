import { Pool } from 'pg';

import { requiredEnvironment } from './config.js';

export function createDatabasePool(): Pool {
  return new Pool({ connectionString: requiredEnvironment('DATABASE_URL'), max: 4 });
}
