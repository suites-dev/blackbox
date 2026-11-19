import type { AttemptView, ExecutionView, StepView } from './types.js';

function escape(value: string | number | null | undefined): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatted(value: unknown): string {
  return escape(JSON.stringify(value, null, 2));
}

function code(value: unknown): string {
  return `<pre>${formatted(value)}</pre>`;
}

function status(value: string): string {
  const known = new Set(['passed', 'verified', 'completed', 'captured', 'available']);
  const failed = new Set(['failed', 'timedOut', 'interrupted', 'unavailable']);
  const tone = known.has(value) ? 'good' : failed.has(value) ? 'bad' : 'caution';
  return `<span class="badge ${tone}">${escape(value)}</span>`;
}

function stepRow(item: StepView): string {
  return `<li class="step"><div class="step-head"><span class="step-kind">${escape(item.kind)}</span>`
    + `<strong>${escape(item.title)}</strong>${status(item.status)}</div>`
    + (item.error === null ? '' : `<p class="error">${escape(item.error)}</p>`)
    + (item.evidence.length === 0 ? '' : `<p class="subtle">Recorded claim references: ${item.evidence.map(escape).join(', ')}</p>`)
    + (item.snapshots === null ? '' : `<details><summary>Snapshot matcher outcomes</summary>${code(item.snapshots)}</details>`)
    + '</li>';
}

function evidencePanel(title: string, value: unknown): string {
  return `<details><summary>${escape(title)}</summary>${value === null ? '<p class="empty">Unavailable</p>' : code(value)}</details>`;
}

function executionSection(execution: ExecutionView, index: number): string {
  const effectStatus = execution.effects.status;
  const coverage = execution.effects.coverage;
  const effectCount = execution.effects.effects.length;
  return `<section class="execution" aria-labelledby="execution-${index}">`
    + `<div class="section-head"><div><span class="eyebrow">Execution ${index + 1}</span><h2 id="execution-${index}">${escape(execution.title)}</h2></div>`
    + `<span class="id">${escape(execution.executionId)}</span></div>`
    + `<div class="columns"><section class="card"><h3>Accepted steps</h3>`
    + (execution.steps.length === 0 ? '<p class="empty">No steps were recorded.</p>' : `<ol class="steps">${execution.steps.map(stepRow).join('')}</ol>`)
    + `</section><section class="card"><h3>Runtime evidence</h3>`
    + evidencePanel('Output', execution.output)
    + evidencePanel('Initial state', execution.initial)
    + evidencePanel('Final state', execution.final)
    + evidencePanel('State diff', execution.diff)
    + `<details open><summary>Effects ${status(effectStatus)} <span class="count">${effectCount} recorded</span></summary>`
    + `<p class="subtle">A recorded effect is diagnostic unless an accepted claim asserts it. Capture coverage determines what absence and exact counts can establish.</p>`
    + (coverage === null ? '<p class="empty">Coverage unavailable.</p>' : code(coverage))
    + (effectStatus === 'captured' && effectCount === 0 ? '<p class="empty">No effects were observed in this capture. An open or unknown coverage cut cannot prove that no effects occurred.</p>' : '')
    + (effectCount === 0 ? '' : code(execution.effects.effects))
    + (execution.effects.relations.length === 0 ? '' : evidencePanel('Effect relations', execution.effects.relations))
    + (execution.effects.omitted === null ? '' : evidencePanel('Omitted evidence counts', execution.effects.omitted))
    + (execution.effects.captures.length === 0 ? '' : evidencePanel('Capture references', execution.effects.captures))
    + `</details></section></div></section>`;
}

function artifacts(view: AttemptView): string {
  return view.evidence.artifacts.length === 0 ? '<p class="empty">No Blackbox attachments were retained.</p>'
    : `<div class="table-wrap"><table><thead><tr><th>Attachment</th><th>Source</th><th>Bytes</th><th>Digest or path</th></tr></thead><tbody>`
      + view.evidence.artifacts.map((item) => `<tr><td>${escape(item.name)}</td><td>${escape(item.source)}</td>`
        + `<td>${item.bytes === null ? 'unknown' : escape(item.bytes)}</td><td class="wrap">${escape(item.digest ?? item.path ?? 'unavailable')}</td></tr>`).join('')
      + '</tbody></table></div>';
}

/** Static, script-free report built only from an already adapted physical attempt. */
export function renderAttemptHtml(view: AttemptView): string {
  const title = view.test.titlePath.join(' › ') || view.test.id;
  const verification = view.verification;
  const attempt = view.attempt;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escape(title)} · Blackbox evidence</title><style>`
    + `:root{color-scheme:dark;--bg:#111217;--panel:#1d1e25;--border:#363740;--text:#f1f0f4;--muted:#b8b9c4;--blue:#a9baff;--green:#91d4b1;--red:#f3a5b1;--amber:#e8c68e}`
    + `*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,sans-serif}`
    + `main{max-width:1260px;margin:auto;padding:36px 28px 80px}h1{font-size:32px;line-height:1.2;margin:8px 0 18px}h2{font-size:21px;margin:5px 0}h3{font-size:15px;margin:0 0 15px}`
    + `.eyebrow,.step-kind,.id,.count{font:12px/1.5 ui-monospace,SFMono-Regular,monospace;color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.12em;color:var(--blue)}`
    + `.hero,.card,.execution{background:var(--panel);border:1px solid var(--border);border-radius:12px}.hero{padding:24px;margin-bottom:22px}`
    + `.meta,.metrics{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.meta{color:var(--muted);font-size:12px}.metrics{margin-top:20px}`
    + `.metric{padding:12px 16px;border:1px solid var(--border);border-radius:9px;min-width:115px}.metric strong{display:block;font-size:20px}.metric span{color:var(--muted);font-size:11px}`
    + `.badge{display:inline-flex;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;background:#393b45;color:var(--muted)}`
    + `.badge.good{background:#253a32;color:var(--green)}.badge.bad{background:#432c32;color:var(--red)}.badge.caution{background:#40382c;color:var(--amber)}`
    + `.execution{padding:22px;margin:22px 0}.section-head,.step-head{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}`
    + `.section-head{margin-bottom:19px}.id{overflow-wrap:anywhere}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:15px}.card{padding:19px;min-width:0}`
    + `.steps{list-style:none;padding:0;margin:0}.step{padding:13px 0;border-top:1px solid var(--border)}.step-head{justify-content:flex-start}.step-head strong{flex:1;min-width:190px}`
    + `.error{color:var(--red);white-space:pre-wrap;overflow-wrap:anywhere}.subtle,.empty{color:var(--muted);font-size:13px}.empty{padding:12px 0}a{color:var(--blue)}a:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:3px;border-radius:3px}`
    + `details{border-top:1px solid var(--border);padding:11px 0}summary{cursor:pointer;font-weight:600;display:flex;align-items:center;gap:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#15161c;border:1px solid var(--border);border-radius:7px;padding:13px;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;max-height:500px;overflow:auto}`
    + `.report-section{margin-top:30px}.report-section h2{margin-bottom:14px}.problem{color:var(--amber)}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th,td{padding:10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted)}.wrap{overflow-wrap:anywhere;font:11px ui-monospace,SFMono-Regular,monospace}.table-wrap{overflow:auto}`
    + `@media(max-width:800px){main{padding:22px 14px}.columns{grid-template-columns:1fr}.hero,.execution{padding:17px}.step-head strong{min-width:0}}`
    + `</style></head><body><main><header class="hero"><span class="eyebrow">Blackbox · Physical attempt ${attempt.retry + 1}</span>`
    + `<h1>${escape(title)}</h1><div class="meta"><span>${escape(view.test.file)}:${escape(view.test.line)}</span><span>Project: ${escape(view.test.project ?? 'unknown')}</span>`
    + `<span>Worker: ${escape(attempt.workerIndex)}</span><span>Duration: ${escape(attempt.durationMs)} ms</span></div>`
    + `<p class="subtle"><a href="report.json" download="report.json">Download adapted JSON</a> · The original Blackbox attachments remain in the Playwright report.</p>`
    + `<div class="metrics"><div class="metric"><strong>${status(attempt.nativeStatus)}</strong><span>Playwright attempt</span></div>`
    + `<div class="metric"><strong>${status(verification.status)}</strong><span>Named verification claims</span></div>`
    + `<div class="metric"><strong>${status(view.evidence.status)}</strong><span>Retained evidence</span></div>`
    + `<div class="metric"><strong>${verification.passed}</strong><span>Passed claims</span></div>`
    + `<div class="metric"><strong>${verification.failed}</strong><span>Failed claims</span></div>`
    + `<div class="metric"><strong>${verification.inconclusive}</strong><span>Inconclusive claims</span></div></div>`
    + (attempt.errors.length === 0 ? '' : `<div class="report-section"><h2>Playwright errors</h2><ul>${attempt.errors.map((error) => `<li class="error">${escape(error)}</li>`).join('')}</ul></div>`)
    + `</header>`
    + (view.executions.length === 0 ? '<section class="card"><h2>No execution record</h2><p class="empty">The native attempt may have failed before Blackbox captured a stimulus.</p></section>' : view.executions.map(executionSection).join(''))
    + `<section class="report-section"><h2>Capture health ${status(view.evidence.captureHealth.status)}</h2>`
    + (view.evidence.captureHealth.record === null ? '<p class="empty">No structured capture-health record is available.</p>' : code(view.evidence.captureHealth.record))
    + (view.evidence.problems.length === 0 ? '<p>No artifact parsing or reference problems were detected by this report adapter.</p>'
      : `<ul>${view.evidence.problems.map((problem) => `<li class="problem">${escape(problem)}</li>`).join('')}</ul>`)
    + `<h2>Artifact inventory</h2>${artifacts(view)}</section>`
    + `<section class="report-section"><h2>Raw adapted record</h2><details><summary>Show JSON</summary>${code(view)}</details></section>`
    + `</main></body></html>`;
}
