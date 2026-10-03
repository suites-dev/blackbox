#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dispositionPath = resolve(rootDir, '.github/security/audit-dispositions.json');

function fail(message) {
  throw new Error(`Dependency audit rejected: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`disposition field ${field} must be a non-empty string`);
  }
  return value;
}

function verifyDisposition(disposition, { root = rootDir, now = new Date() } = {}) {
  const expectedStrings = [
    'advisory',
    'package',
    'affectedVersion',
    'severity',
    'cve',
    'status',
    'patchPath',
    'patchSha256',
    'owner',
    'reviewDate',
    'expires',
    'approval',
    'evidence',
    'removalCondition',
  ];
  for (const field of expectedStrings) {
    requiredString(disposition[field], field);
  }
  if (!Number.isSafeInteger(disposition.auditId)) {
    fail('disposition field auditId must be an integer');
  }
  if (disposition.status !== 'locally-patched') {
    fail(`unsupported disposition status ${disposition.status}`);
  }
  requiredString(disposition.upstreamFix?.url, 'upstreamFix.url');
  requiredString(disposition.upstreamFix?.commit, 'upstreamFix.commit');
  if (disposition.patchPath.includes('..') || disposition.patchPath.startsWith('/')) {
    fail('patchPath must stay inside the repository');
  }
  if (disposition.evidence.includes('..') || disposition.evidence.startsWith('/')) {
    fail('evidence must stay inside the repository');
  }
  if (!/^@[A-Za-z0-9-]+$/.test(disposition.owner)) {
    fail('owner must be a GitHub login');
  }
  if (!disposition.approval.includes('independent maintainer approval')) {
    fail('approval must require independent maintainer review');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disposition.reviewDate)) {
    fail('reviewDate must be YYYY-MM-DD');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disposition.expires)) {
    fail('expires must be YYYY-MM-DD');
  }
  const expiration = new Date(`${disposition.expires}T23:59:59.999Z`);
  const reviewDate = new Date(`${disposition.reviewDate}T00:00:00.000Z`);
  if (Number.isNaN(reviewDate.valueOf()) || reviewDate > now) {
    fail(`disposition ${disposition.advisory} has an invalid future review date`);
  }
  if (Number.isNaN(expiration.valueOf()) || expiration < reviewDate || now > expiration) {
    fail(`disposition ${disposition.advisory} expired on ${disposition.expires}`);
  }

  const patch = readFileSync(resolve(root, disposition.patchPath));
  const digest = createHash('sha256').update(patch).digest('hex');
  if (digest !== disposition.patchSha256) {
    fail(`patch digest for ${disposition.advisory} does not match its reviewed record`);
  }
  readFileSync(resolve(root, disposition.evidence));

  const manifest = readJson(resolve(root, 'package.json'));
  const patchKey = `${disposition.package}@${disposition.affectedVersion}`;
  if (manifest.pnpm?.patchedDependencies?.[patchKey] !== disposition.patchPath) {
    fail(`${patchKey} is not pinned to ${disposition.patchPath}`);
  }
}

function advisoryEntries(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    fail('scanner output is not a JSON object');
  }
  if (report.error !== undefined) {
    const detail = report.error?.message || report.error?.code || 'unknown scanner error';
    fail(`scanner returned an error: ${detail}`);
  }
  if (report.advisories === null || typeof report.advisories !== 'object') {
    fail('scanner output has no advisories object');
  }
  if (!Array.isArray(report.muted)) {
    fail('scanner output has no muted array');
  }
  if (report.muted.length > 0) {
    fail(`scanner muted ${report.muted.length} advisories outside the reviewed disposition`);
  }
  const entries = Object.entries(report.advisories);
  const counts = report.metadata?.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (
    counts === null ||
    typeof counts !== 'object' ||
    severities.some((severity) => !Number.isSafeInteger(counts[severity]) || counts[severity] < 0)
  ) {
    fail('scanner vulnerability counts are missing or invalid');
  }
  if (severities.reduce((total, severity) => total + counts[severity], 0) !== entries.length) {
    fail('scanner vulnerability counts do not match its advisories');
  }
  return entries;
}

function verifyAction(report, disposition) {
  if (!Array.isArray(report.actions) || report.actions.length !== 1) {
    fail(`${disposition.advisory} must have exactly one review action`);
  }
  const action = report.actions[0];
  if (
    action.action !== 'review' ||
    action.module !== disposition.package ||
    !Array.isArray(action.resolves) ||
    action.resolves.length !== 1
  ) {
    fail(`${disposition.advisory} review action changed`);
  }
  const resolution = action.resolves[0];
  if (
    resolution.id !== disposition.auditId ||
    typeof resolution.path !== 'string' ||
    !resolution.path.endsWith(`>${disposition.package}`) ||
    resolution.dev !== false ||
    resolution.bundled !== false ||
    resolution.optional !== false
  ) {
    fail(`${disposition.advisory} review resolution changed`);
  }
}

function verifyFinding(advisory, disposition) {
  const versions = new Set();
  let pathCount = 0;
  if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
    fail(`${disposition.advisory} has no findings`);
  }
  for (const finding of advisory.findings) {
    versions.add(finding.version);
    if (!Array.isArray(finding.paths) || finding.paths.length === 0) {
      fail(`${disposition.advisory} has a finding with no dependency path`);
    }
    for (const dependencyPath of finding.paths) {
      pathCount += 1;
      if (!dependencyPath.endsWith(`${disposition.package}@${disposition.affectedVersion}`)) {
        fail(`${disposition.advisory} contains an unexpected affected path`);
      }
    }
  }
  if (versions.size !== 1 || !versions.has(disposition.affectedVersion)) {
    fail(`${disposition.advisory} affects a version outside its disposition`);
  }
  return pathCount;
}

export function evaluateAuditReport(report, dispositionDocument, options = {}) {
  const entries = advisoryEntries(report);
  const dispositions = dispositionDocument?.dispositions;
  if (!Array.isArray(dispositions)) {
    fail('audit disposition document has no dispositions array');
  }

  if (entries.length === 0) {
    if (dispositions.length > 0) {
      fail('audit is clean but a stale disposition remains; remove it and reassess the patch');
    }
    return [];
  }
  if (entries.length !== dispositions.length) {
    fail(
      `scanner reported ${entries.length} advisories but ${dispositions.length} are dispositioned`,
    );
  }

  const accepted = [];
  for (const disposition of dispositions) {
    verifyDisposition(disposition, options);
    const match = entries.find(
      ([, advisory]) => advisory.github_advisory_id === disposition.advisory,
    );
    if (!match) {
      fail(`scanner did not report dispositioned advisory ${disposition.advisory}`);
    }
    const [auditId, advisory] = match;
    if (
      Number(auditId) !== disposition.auditId ||
      advisory.id !== disposition.auditId ||
      advisory.module_name !== disposition.package ||
      advisory.severity !== disposition.severity ||
      advisory.vulnerable_versions !== `<=${disposition.affectedVersion}` ||
      advisory.patched_versions !== '<0.0.0' ||
      advisory.recommendation !== 'None' ||
      !Array.isArray(advisory.cves) ||
      advisory.cves.length !== 1 ||
      advisory.cves[0] !== disposition.cve
    ) {
      fail(`${disposition.advisory} metadata changed; reassess the disposition`);
    }
    verifyAction(report, disposition);
    const pathCount = verifyFinding(advisory, disposition);
    accepted.push({ advisory: disposition.advisory, package: disposition.package, pathCount });
  }

  const acceptedIds = new Set(dispositions.map(({ advisory }) => advisory));
  for (const [, advisory] of entries) {
    if (!acceptedIds.has(advisory.github_advisory_id)) {
      fail(`undispositioned advisory ${advisory.github_advisory_id || advisory.id}`);
    }
  }
  return accepted;
}

export function parseAuditOutput(output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`scanner output is not valid JSON: ${error.message}`);
  }
}

export function runAudit() {
  const result = spawnSync('pnpm', ['audit', '--audit-level=low', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  if (result.error) {
    fail(`scanner could not run: ${result.error.message}`);
  }
  if (result.signal || ![0, 1].includes(result.status)) {
    fail(
      `scanner exited unexpectedly (status ${result.status}, signal ${result.signal || 'none'})`,
    );
  }
  const report = parseAuditOutput(result.stdout);
  const dispositionDocument = readJson(dispositionPath);
  const accepted = evaluateAuditReport(report, dispositionDocument);
  if (result.status === 0 && accepted.length > 0) {
    fail('scanner exited cleanly while reporting a dispositioned advisory');
  }
  if (result.status === 1 && accepted.length === 0) {
    fail('scanner failed without an accepted disposition');
  }
  for (const item of accepted) {
    console.log(
      `Accepted locally patched disposition ${item.advisory} for ${item.package} across ${item.pathCount} dependency paths.`,
    );
  }
  console.log('Dependency audit completed without undispositioned advisories.');
}

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try {
    runAudit();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
