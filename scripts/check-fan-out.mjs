import { readFileSync } from 'node:fs';
import { argv, exit, stdin } from 'node:process';
import { fileURLToPath } from 'node:url';

// Fan-out gate over dependency-cruiser JSON. dependency-cruiser can bound how
// many modules import a module (fan-in) but not how many a module imports, so
// this script counts it: a production module may depend on at most LIMIT
// distinct production modules of the workspace. Usage:
//   depcruise packages --config .dependency-cruiser.cjs --output-type json |
//     node scripts/check-fan-out.mjs [allowlist.json]

export const LIMIT = 12;

// Mirrors NON_PRODUCTION in .dependency-cruiser.cjs.
const NON_PRODUCTION =
  /(\.(test|spec|fixture)\.[cm]?[jt]s$|\/(testing|test-fixtures|__tests__)\/)|^packages\/[^/]+\/(vitest(\.integration)?\.config\.ts$|scripts\/)/;
const PRODUCTION_SOURCE = /^packages\/[^/]+\/src\//;
// Barrels and command registries exist to gather many modules in one place.
const EXEMPT = /\/(index|command-registry)\.ts$/;

const isProduction = (path) => PRODUCTION_SOURCE.test(path) && !NON_PRODUCTION.test(path);

/** Distinct production workspace modules each production module depends on. */
export function fanOut(cruise) {
  if (!cruise || !Array.isArray(cruise.modules) || cruise.modules.length === 0) {
    // An empty or foreign document must not read as "no violations".
    throw new Error('expected dependency-cruiser JSON with a non-empty modules array');
  }
  return new Map(
    cruise.modules
      .filter((module) => isProduction(module.source) && !EXEMPT.test(module.source))
      .map((module) => [
        module.source,
        new Set(
          module.dependencies
            .map((dependency) => dependency.resolved)
            .filter((resolved) => isProduction(resolved) && resolved !== module.source),
        ).size,
      ]),
  );
}

/**
 * New violators fail, and so do allowlist entries that no longer exceed the
 * limit or no longer exist: the allowlist may only shrink, and a stale entry
 * would silently re-admit that module later.
 */
export function checkFanOut({ cruise, allowlist, limit = LIMIT }) {
  const counts = fanOut(cruise);
  const problems = [];
  for (const [source, count] of counts) {
    if (count > limit && !Object.hasOwn(allowlist, source)) {
      problems.push(
        `${source} depends on ${count} workspace modules (limit ${limit}). Split it, or extract a collaborator.`,
      );
    }
  }
  for (const [source, reason] of Object.entries(allowlist)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${source} is allowlisted without a reason.`);
    } else if (!counts.has(source)) {
      problems.push(`${source} is allowlisted but is not a production module. Remove the entry.`);
    } else if (counts.get(source) <= limit) {
      problems.push(
        `${source} is allowlisted but now depends on ${counts.get(source)} modules. Remove the entry.`,
      );
    }
  }
  return problems;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const allowlistPath = argv[2] ?? new URL('fan-out-allowlist.json', import.meta.url);
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const problems = checkFanOut({ cruise: JSON.parse(await readStdin()), allowlist });
  for (const problem of problems) {
    console.error(`error fan-out: ${problem}`);
  }
  if (problems.length > 0) {
    exit(1);
  }
  console.log(
    `fan-out: no production module above ${LIMIT} workspace dependencies outside the ${Object.keys(allowlist).length}-entry allowlist`,
  );
}
