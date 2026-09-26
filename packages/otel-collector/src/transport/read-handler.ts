import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CollectorStore } from '../lifecycle/store.js';
import type { StartCollectorInput } from '../model/types.js';
import { recordedFailure } from '../model/validation.js';
import {
  readCollectorSession,
  readCollectorTrace,
} from '../storage/reader.js';
import { readCollectorActivity } from '../storage/activity-reader.js';
import { RequestFailure, writeJson } from './response.js';

export async function serveCollectorRead(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore;
  readonly path: string;
}): Promise<void> {
  const tracePrefix = `${input.config.endpoint.readPath}/traces/`;
  const activityPrefix = `${input.config.endpoint.readPath}/activities/`;
  const knownPath =
    input.path === input.config.endpoint.readPath ||
    input.path === `${input.config.endpoint.readPath}/session` ||
    input.path.startsWith(tracePrefix) ||
    input.path.startsWith(activityPrefix);
  if (!knownPath) {
    throw new RequestFailure(404, 'Collector endpoint not found.');
  }
  if (input.request.method !== 'GET') {
    throw new RequestFailure(405, 'Collector read endpoints require GET.');
  }
  if (input.path === input.config.endpoint.readPath) {
    writeJson({ response: input.response, status: 200, value: input.store.status() });
    return;
  }
  if (input.path === `${input.config.endpoint.readPath}/session`) {
    const result = await readCollectorSession(input.config);
    writeJson({
      response: input.response,
      status:
        result.kind === 'collector-session-missing'
          ? 404
          : result.kind === 'collector-session-corrupt'
            ? 500
            : 200,
      value: result,
    });
    return;
  }
  try {
    if (input.path.startsWith(activityPrefix)) {
      const activityId = decodeURIComponent(input.path.slice(activityPrefix.length));
      const result = await readCollectorActivity({ ...input.config, activityId });
      writeJson({
        response: input.response,
        status:
          result.kind === 'collector-activity-missing'
            ? 404
            : result.kind === 'collector-activity-corrupt'
              ? 500
              : 200,
        value: result,
      });
      return;
    }
    const traceId = decodeURIComponent(input.path.slice(tracePrefix.length));
    const result = await readCollectorTrace({ ...input.config, traceId });
    writeJson({
      response: input.response,
      status:
        result.kind === 'collector-trace-missing'
          ? 404
          : result.kind === 'collector-trace-corrupt'
            ? 500
            : 200,
      value: result,
    });
  } catch (error) {
    throw new RequestFailure(400, recordedFailure(error).message);
  }
}
