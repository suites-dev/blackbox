import type { IDockerComposeOptions } from 'docker-compose';
import type { ComposeStartRequest } from '../../model/compose.js';

export function composeOptions(
  request: ComposeStartRequest,
  commandOptions: readonly string[],
): IDockerComposeOptions {
  return {
    cwd: request.projectDirectory,
    config: [...request.composeFiles],
    composeOptions: ['--project-name', request.projectName],
    commandOptions: [...commandOptions],
    env: { ...process.env, ...request.environment },
  };
}

/** Testcontainers 12.2 keeps the winning strategy's Compose environment on its Compose client.
 * Its public client has no build or create method. Use that exact environment for our direct calls.
 */
export function runtimeComposeEnvironment(compose: object): Record<string, string> {
  if (!('environment' in compose) || typeof compose.environment !== 'object' || compose.environment === null) {
    throw new Error('Testcontainers did not provide the selected Docker Compose connection');
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(compose.environment)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}
