import * as fs from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_ROOT = 'e2e/.blackbox/tmp';
const RECEIPTS = [
  'receipt.txt', 'capsule-start.json', 'capsule-stop.json', 'cleanup-stop.json',
  'capsule-report.json', 'served-running-after.json', 'served-stopped.json',
  'served-reopened.json', 'catalog-validate.json', 'catalog-list.json',
  'instrumentation-install.txt', 'instrumentation-repeat.txt',
];

export const capsuleEvidenceRoots = ['e2e/.blackbox/experiments', 'e2e/.blackbox/reports'];

export async function capsuleEvidenceSources(root) {
  const sources = [...capsuleEvidenceRoots];
  const directory = path.join(root, RUNTIME_ROOT);
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Capsule runtime receipts cannot traverse symlinks or non-directories');
  } catch (error) {
    if (error.code === 'ENOENT') return sources;
    throw error;
  }
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^capsule-test\.[A-Za-z0-9]+$/u.test(entry.name)) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Capsule receipt directory must be a real directory: ${entry.name}`);
    for (const name of RECEIPTS) sources.push(`${RUNTIME_ROOT}/${entry.name}/${name}`);
  }
  return sources;
}

export async function requireCapsuleSuccessEvidence(root, entries) {
  const files = new Set(entries.filter((entry) => entry.type === 'file' && entry.bytes > 0).map((entry) => entry.path));
  const receipts = [...files].filter((name) => name.startsWith(`${RUNTIME_ROOT}/`) && name.endsWith('/receipt.txt'));
  if (receipts.length !== 1) throw new Error('Successful Capsule E2E requires exactly one nonempty journey receipt');
  const receiptPath = receipts[0];
  const receipt = await fs.readFile(path.join(root, receiptPath), 'utf8');
  const identities = receipt.split('\n').filter((line) => line.startsWith('session='));
  if (
    identities.length !== 1
    || !/^session=[a-z]+-[a-z]+-[a-z]+-[0-9]{12}$/u.test(identities[0])
  ) {
    throw new Error('Capsule journey receipt requires one exact session identity');
  }
  const sessionId = identities[0].slice('session='.length);
  const runtime = path.posix.dirname(receiptPath);
  const experiment = `e2e/.blackbox/experiments/capsule-${sessionId}`;
  const required = [
    ...['session.json', 'activities.json', 'progress.json'].map((name) => `${experiment}/${name}`),
    ...['capsule-start.json', 'capsule-stop.json', 'capsule-report.json', 'served-stopped.json', 'served-reopened.json'].map((name) => `${runtime}/${name}`),
    `e2e/.blackbox/reports/capsule-${sessionId}/capsule-report.html`,
  ];
  const missing = required.filter((name) => !files.has(name));
  if (missing.length) throw new Error(`Missing required Capsule evidence: ${missing.join(', ')}`);
}
