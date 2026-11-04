import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { evaluateAuditReport, parseAuditOutput } from './audit-workspace.mjs';

const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

const patch = 'reviewed patch fixture\n';
const patchDigest = '7fa3a872575f53565c6b9c571ec551e758ca0b38f7dd0c092c65c960833de11a';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'blackbox-audit-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'patches'));
  mkdirSync(join(root, 'scripts/security'), { recursive: true });
  writeFileSync(join(root, 'patches/cache.patch'), patch);
  writeFileSync(join(root, 'scripts/security/regression.test.mjs'), 'fixture');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      pnpm: { patchedDependencies: { 'http-cache-semantics@4.2.0': 'patches/cache.patch' } },
    }),
  );
  const disposition = {
    advisory: 'GHSA-ch52-4w7c-c8xp',
    auditId: 1240991,
    package: 'http-cache-semantics',
    affectedVersion: '4.2.0',
    severity: 'high',
    cve: 'CVE-2026-93748',
    status: 'locally-patched',
    patchPath: 'patches/cache.patch',
    patchSha256: patchDigest,
    upstreamFix: { url: 'https://example.test/pull/58', commit: 'abc' },
    owner: '@owner',
    reviewDate: '2026-10-03',
    expires: '2026-10-17',
    approval: 'Requires independent maintainer approval of the delivery PR',
    evidence: 'scripts/security/regression.test.mjs',
    removalCondition: 'Remove after a fixed release is verified',
  };
  const advisory = {
    id: 1240991,
    github_advisory_id: 'GHSA-ch52-4w7c-c8xp',
    module_name: 'http-cache-semantics',
    severity: 'high',
    vulnerable_versions: '<=4.2.0',
    patched_versions: '<0.0.0',
    recommendation: 'None',
    cves: ['CVE-2026-93748'],
    findings: [
      {
        version: '4.2.0',
        paths: ['. > lerna@10.0.1 > make-fetch-happen@15.0.2 > http-cache-semantics@4.2.0'],
      },
    ],
  };
  const report = {
    actions: [
      {
        action: 'review',
        module: 'http-cache-semantics',
        resolves: [
          {
            id: 1240991,
            path: '.>lerna>make-fetch-happen>http-cache-semantics',
            dev: false,
            bundled: false,
            optional: false,
          },
        ],
      },
    ],
    advisories: { 1240991: advisory },
    muted: [],
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    },
  };
  return { root, disposition, advisory, report };
}

const options = (root) => ({ root, now: new Date('2026-10-03T12:00:00Z') });

test('accepts only the exact locally patched advisory', () => {
  const { root, disposition, report } = fixture();
  assert.deepEqual(evaluateAuditReport(report, { dispositions: [disposition] }, options(root)), [
    { advisory: 'GHSA-ch52-4w7c-c8xp', package: 'http-cache-semantics', pathCount: 1 },
  ]);
});

test('rejects an additional advisory', () => {
  const { root, disposition, report, advisory } = fixture();
  report.advisories['9999999'] = {
    ...advisory,
    id: 9999999,
    github_advisory_id: 'GHSA-unknown',
  };
  report.metadata.vulnerabilities.high = 2;
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /reported 2 advisories but 1 are dispositioned/,
  );
});

test('rejects scanner errors instead of treating them as a clean audit', () => {
  const { root, disposition } = fixture();
  assert.throws(
    () =>
      evaluateAuditReport(
        { error: { code: 'ENOTFOUND', message: 'registry unavailable' } },
        { dispositions: [disposition] },
        options(root),
      ),
    /scanner returned an error/,
  );
  assert.throws(() => parseAuditOutput('not json'), /scanner output is not valid JSON/);
});

test('rejects advisories muted by the package manager', () => {
  const { root, disposition, report } = fixture();
  report.muted = ['GHSA-hidden'];
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /scanner muted 1 advisories/,
  );
});

test('rejects inconsistent counts and changed review actions', () => {
  const { root, disposition, report } = fixture();
  report.metadata.vulnerabilities.high = 2;
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /counts do not match/,
  );

  report.metadata.vulnerabilities.high = 1;
  report.actions[0].module = 'another-package';
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /review action changed/,
  );
});

test('rejects changed upstream remediation metadata', () => {
  const { root, disposition, report } = fixture();
  report.advisories['1240991'].patched_versions = '>=4.2.1';
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /metadata changed/,
  );
});

test('rejects stale or expired dispositions', () => {
  const { root, disposition, report } = fixture();
  report.actions = [];
  report.advisories = {};
  report.metadata.vulnerabilities.high = 0;
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /stale disposition remains/,
  );
  assert.throws(
    () =>
      evaluateAuditReport(
        fixture().report,
        { dispositions: [disposition] },
        { root, now: new Date('2026-10-18T00:00:00Z') },
      ),
    /expired/,
  );
});

test('rejects patch drift and affected paths outside the reviewed package version', () => {
  const { root, disposition, report } = fixture();
  writeFileSync(join(root, 'patches/cache.patch'), 'changed patch');
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /patch digest.*does not match/,
  );

  writeFileSync(join(root, 'patches/cache.patch'), patch);
  report.advisories['1240991'].findings[0].paths = ['. > other-package@1.0.0'];
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /unexpected affected path/,
  );
});

test('counts affected versions per severity while retaining the unique advisory gate', () => {
  const { root, report, advisory } = fixture();
  const finding = (version) => ({ version, paths: [`root > package@${version}`] });
  report.advisories = {
    1: { ...advisory, severity: 'moderate', findings: ['1', '2', '3', '4', '5'].map(finding) },
    2: { ...advisory, severity: 'moderate', findings: ['6', '7', '8'].map(finding) },
  };
  report.metadata.vulnerabilities = { info: 0, low: 0, moderate: 8, high: 0, critical: 0 };
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [] }, options(root)),
    /reported 2 advisories but 0 are dispositioned/,
  );
  delete report.advisories[2];
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [] }, options(root)),
    /counts do not match/,
  );
});

test('rejects wrong per-severity totals even when the grand total matches', () => {
  const { root, disposition, report } = fixture();
  report.metadata.vulnerabilities = { info: 0, low: 0, moderate: 1, high: 0, critical: 0 };
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /counts do not match/,
  );
  report.metadata.vulnerabilities.high = 2;
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /counts do not match/,
  );
});

test('rejects malformed findings instead of accepting incomplete scanner data', () => {
  for (const findings of [
    undefined,
    null,
    [],
    {},
    [null],
    ['finding'],
    [{}],
    [{ version: '', paths: ['root'] }],
    [{ version: '1', paths: [] }],
    [{ version: '1', paths: [''] }],
    [{ version: '1', paths: [null] }],
    [{ version: '1', paths: 'root' }],
  ]) {
    const { root, disposition, report, advisory } = fixture();
    advisory.findings = findings;
    assert.throws(
      () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
      /no findings|invalid finding/,
    );
  }
  for (const severity of [undefined, null, 'unknown']) {
    const { root, disposition, report, advisory } = fixture();
    advisory.severity = severity;
    assert.throws(
      () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
      /invalid severity/,
    );
  }
});

test('accepts a clean audit only with no obsolete dispositions', () => {
  const { root, report } = fixture();
  report.actions = [];
  report.advisories = {};
  report.metadata.vulnerabilities.high = 0;
  assert.deepEqual(evaluateAuditReport(report, { dispositions: [] }, options(root)), []);
});

test('rejects missing and noninteger scanner counts', () => {
  for (const count of [undefined, null, -1, 0.5, '1', Number.NaN]) {
    const { root, disposition, report } = fixture();
    report.metadata.vulnerabilities.high = count;
    assert.throws(
      () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
      /counts are missing or invalid/,
    );
  }
  const { root, disposition, report } = fixture();
  report.metadata.vulnerabilities.high = 0;
  assert.throws(
    () => evaluateAuditReport(report, { dispositions: [disposition] }, options(root)),
    /counts do not match/,
  );
});
