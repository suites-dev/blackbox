import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { renderCapsuleHtml } from '../../../index.js';
import { capsuleReportClientView } from '../../html/client-view.js';
import { capsuleCausalityScript } from '../../html/causality/view.js';
import type { CapsuleReportLimitation } from '../../causality/types.js';
import { report as earlierReport } from '../../../schema/report.fixture.js';
import {
  CAUSED_TRACE,
  UNLINKED_TRACE,
  completedDriverActivity,
  first,
  report,
  session,
} from './causality.fixture.js';
import { overlapping, stimulus } from './scenario.fixture.js';

/** Minimal stand-ins for the client view's DOM helpers: plain objects instead of elements. */
const helpers = `
const n = (tag, className, text) => ({ tag, className, text, children: [], setAttribute() {} });
const badge = (text, tone) => ({ badge: text, tone: tone || 'neutral' });
const p = (text) => ({ p: text });
const add = (parent, ...children) => { parent.children.push(...children.filter(Boolean)); return parent; };
`;

function evaluate(expression: string): unknown {
  const context = { output: null as unknown };
  new Script(`${helpers}${capsuleCausalityScript}\noutput = ${expression};`).runInNewContext(
    context,
  );
  return JSON.parse(JSON.stringify(context.output)) as unknown;
}

const WORDS = /\b(?:success|successful|passed|verified|effects?)\b/iu;

describe('the client view states cause only by trace context', () => {
  it('never refers to a temporal window, so re-enabling it fails here', () => {
    const script = capsuleReportClientView.script;
    expect(script).not.toContain('activity-window');
    expect(script).not.toContain('temporal');
    expect(script).not.toContain('time window');
  });

  it('draws caused traces from the causal fields, not from the temporal association', () => {
    const document = overlapping();
    const block = evaluate(
      `causedTraces(${JSON.stringify(stimulus)}, ${JSON.stringify(document)})`,
    );
    const text = JSON.stringify(block);
    expect(text).toContain(CAUSED_TRACE);
    expect(text).toContain('POST /orders');
    expect(text).not.toContain(UNLINKED_TRACE);
    expect(text).not.toContain('consume');
  });

  it('lists the unlinked trace with the same warning the CLI prints', () => {
    const document = overlapping();
    const notes = JSON.stringify(
      evaluate(
        `uncausedNotes(${JSON.stringify(document)}, ${JSON.stringify(first(document.uncaused))})`,
      ),
    );
    expect(notes).toContain('Placed after activity c0ffee00 by time (display order only).');
    expect(notes).toContain('Blackbox cannot prove that c0ffee00 caused bbbbbbbb.');
    expect(notes).toContain('no trace context links them');
  });

  it('puts status first, as the CLI words it', () => {
    const text = (status: object) =>
      JSON.stringify(evaluate(`statusBanner(${JSON.stringify(status)})`));
    expect(text({ status: 'provisional' })).toContain('provisional (capsule running)');
    expect(text({ status: 'complete' })).toContain('"complete"');
    expect(text({ status: 'incomplete', reason: 'collector interrupted' })).toContain(
      'incomplete (collector interrupted)',
    );
  });
});

describe('the report shows no command line', () => {
  it('embeds no argv of any activity', () => {
    const html = renderCapsuleHtml({
      report: report({
        activities: [stimulus, completedDriverActivity()],
        observations: session([]),
      }),
    });
    for (const secret of ['curl', 'http://localhost', 'psql', '--password', 'trace=present']) {
      expect(html).not.toContain(secret);
    }
  });
});

describe('limitation wording', () => {
  const all = [
    { kind: 'observation-provisional' },
    { kind: 'observation-incomplete', reason: 'collector interrupted' },
    { kind: 'causality-unknown', trace: UNLINKED_TRACE },
    { kind: 'untraced' },
    { kind: 'context-not-carried', resource: 'postgresql' },
    { kind: 'context-injection-failed', carrier: 'http-headers', message: 'refused' },
    { kind: 'orphan-span', spanId: 'a000000000000001', trace: CAUSED_TRACE },
    { kind: 'observation-unavailable', trace: CAUSED_TRACE, reason: 'corrupt' },
  ] satisfies readonly CapsuleReportLimitation[];

  it('uses none of success, successful, passed, verified, effect or effects', () => {
    for (const limitation of all) {
      const text = String(evaluate(`limitationText(${JSON.stringify(limitation)})`));
      expect(text).not.toBe('Unsupported limitation.');
      expect(text).not.toMatch(WORDS);
    }
    expect(capsuleCausalityScript).not.toMatch(WORDS);
  });
});

describe('old reports still render', () => {
  // A report as written before the causal fields existed.
  const old = earlierReport();

  it('renders without the causal fields, saying the status was not recorded', () => {
    const banner = JSON.stringify(evaluate(`statusBanner(${JSON.stringify(old)})`));
    expect(banner).toContain('not recorded');
    expect(
      evaluate(`causedTraces(${JSON.stringify(stimulus)}, ${JSON.stringify(old)})`),
    ).toBeNull();
    expect(
      evaluate(`activityLimitations(${JSON.stringify(stimulus)}, ${JSON.stringify(old)})`),
    ).toBeNull();
    expect(
      evaluate(`evidenceInfo(${JSON.stringify(stimulus)}, ${JSON.stringify(old)}).label`),
    ).toBe('Response');
    expect(renderCapsuleHtml({ report: old })).toContain('<!doctype html>');
  });
});
