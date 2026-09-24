import { isAbsolute, posix, resolve, sep, win32 } from 'node:path';

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import { catalogSchema } from './blackbox-schema.js';
import { decodeCatalogConfig, type SchemaBlackboxConfig } from './catalog-decoder.js';
import type {
  BlackboxConfig,
  CatalogValidationIssue,
  ObservationBoundary,
} from '../model/catalog-types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
if (!ajv.validateSchema(catalogSchema)) {
  throw new Error(`Invalid bundled Blackbox catalog schema: ${ajv.errorsText(ajv.errors)}`);
}
const validateSchema: ValidateFunction<SchemaBlackboxConfig> =
  ajv.compile<SchemaBlackboxConfig>(catalogSchema);

export class CatalogValidationError extends Error {
  readonly sourceName: string;
  readonly issues: readonly CatalogValidationIssue[];

  constructor(input: CatalogValidationErrorInput) {
    const { sourceName, issues } = input;
    super(formatValidationMessage(sourceName, issues));
    this.name = 'CatalogValidationError';
    this.sourceName = sourceName;
    this.issues = issues;
  }
}

export interface CatalogValidationErrorInput {
  readonly sourceName: string;
  readonly issues: readonly CatalogValidationIssue[];
}

function formatValidationMessage(
  sourceName: string,
  issues: readonly CatalogValidationIssue[],
): string {
  const details = issues
    .map((issue) => `- ${issue.instancePath || '/'}: ${issue.message}`)
    .join('\n');
  return `Invalid Blackbox catalog ${sourceName}:\n${details}`;
}

function schemaIssues(errors: readonly ErrorObject[] | null | undefined): CatalogValidationIssue[] {
  return (errors ?? []).map((error) => {
    const suffix =
      error.keyword === 'additionalProperties' &&
      typeof error.params.additionalProperty === 'string'
        ? ` (${error.params.additionalProperty})`
        : '';
    return {
      kind: 'schema',
      instancePath: error.instancePath || '/',
      message: `${error.message ?? 'does not match the schema'}${suffix}`,
    };
  });
}

function semanticIssue(instancePath: string, message: string): CatalogValidationIssue {
  return { kind: 'semantic', instancePath, message };
}

function validateRelativePath(pathValue: string, instancePath: string): CatalogValidationIssue[] {
  if (pathValue.trim() === '') {
    return [semanticIssue(instancePath, 'must not be blank')];
  }
  if (pathValue.includes('\0')) {
    return [semanticIssue(instancePath, 'must not contain a NUL byte')];
  }
  if (isAbsolute(pathValue) || posix.isAbsolute(pathValue) || win32.isAbsolute(pathValue)) {
    return [semanticIssue(instancePath, 'must be relative to the project directory')];
  }
  const segments = pathValue.split(/[\\/]+/u);
  if (segments.includes('..')) {
    return [semanticIssue(instancePath, 'must not escape the project directory with ..')];
  }

  // This second check protects against platform-specific normalization behavior.
  const root = resolve(`${sep}blackbox-project-root`);
  const candidate = resolve(root, pathValue);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return [semanticIssue(instancePath, 'must resolve inside the project directory')];
  }
  return [];
}

function duplicateBoundaryIssues(
  boundaries: readonly ObservationBoundary[],
  entryPath: string,
): CatalogValidationIssue[] {
  const seen = new Set<string>();
  const issues: CatalogValidationIssue[] = [];
  for (const [index, boundary] of boundaries.entries()) {
    if (seen.has(boundary.id)) {
      issues.push(
        semanticIssue(`${entryPath}/observation/boundaries/${index}/id`, 'must be unique'),
      );
    }
    seen.add(boundary.id);
  }
  return issues;
}

function semanticIssues(config: BlackboxConfig): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (!Object.hasOwn(config.catalog.entries, config.catalog.default)) {
    issues.push(
      semanticIssue('/catalog/default', `does not name a catalog entry: ${config.catalog.default}`),
    );
  }

  for (const [entryId, entry] of Object.entries(config.catalog.entries)) {
    const entryPath = `/catalog/entries/${entryId}`;
    if (!Object.hasOwn(entry.participants, entry.entrypoint.participant)) {
      issues.push(
        semanticIssue(
          `${entryPath}/entrypoint/participant`,
          `does not name a participant in ${entryId}: ${entry.entrypoint.participant}`,
        ),
      );
    }

    for (const [index, composeFile] of entry.acquisition.files.entries()) {
      issues.push(...validateRelativePath(composeFile, `${entryPath}/acquisition/files/${index}`));
    }

    for (const [participantId, participant] of Object.entries(entry.participants)) {
      if (
        participant.activation.kind === 'configured' &&
        !Object.hasOwn(config.activations, participant.activation.activationId)
      ) {
        issues.push(
          semanticIssue(
            `${entryPath}/participants/${participantId}/activation`,
            `does not name an activation: ${participant.activation.activationId}`,
          ),
        );
      }
    }

    issues.push(...duplicateBoundaryIssues(entry.observation.boundaries, entryPath));
    const boundaryIds = new Set(entry.observation.boundaries.map((boundary) => boundary.id));
    for (const [index, boundaryId] of entry.observation.requiredBoundaries.entries()) {
      if (!boundaryIds.has(boundaryId)) {
        issues.push(
          semanticIssue(
            `${entryPath}/observation/requiredBoundaries/${index}`,
            `does not name an observation boundary in ${entryId}: ${boundaryId}`,
          ),
        );
      }
    }
  }

  for (const [activationId, activation] of Object.entries(config.activations)) {
    issues.push(...validateRelativePath(activation.ref, `/activations/${activationId}/ref`));
  }
  for (const [clientId, client] of Object.entries(config.clients)) {
    const clientPath = `/clients/${clientId}`;
    issues.push(...validateRelativePath(client.ref, `${clientPath}/ref`));
    if (client.target.kind !== 'participant') {
      continue;
    }
    const participantId = client.target.participant;
    if (
      !Object.values(config.catalog.entries).some((entry) =>
        Object.hasOwn(entry.participants, participantId),
      )
    ) {
      issues.push(
        semanticIssue(
          `${clientPath}/target/participant`,
          `does not name a participant in any catalog entry: ${participantId}`,
        ),
      );
    }
  }
  return issues;
}

export interface ValidateCatalogDocumentInput {
  readonly document: unknown;
  readonly sourceName: string;
}

export function validateCatalogDocument(input: ValidateCatalogDocumentInput): BlackboxConfig {
  const { document, sourceName } = input;
  if (!validateSchema(document)) {
    throw new CatalogValidationError({
      sourceName,
      issues: schemaIssues(validateSchema.errors),
    });
  }
  const config = decodeCatalogConfig(document);
  const issues = semanticIssues(config);
  if (issues.length > 0) {
    throw new CatalogValidationError({ sourceName, issues });
  }
  return config;
}

export function validateBundledCatalogSchema(): true {
  if (!ajv.validateSchema(catalogSchema)) {
    throw new Error(ajv.errorsText(ajv.errors));
  }
  return true;
}
