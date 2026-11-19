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
