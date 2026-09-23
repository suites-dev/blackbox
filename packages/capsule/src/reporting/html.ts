import { capsuleReportClientView } from './client-view.js';
import { escapeHtml } from './html-format.js';
import type { CapsuleReportDocument } from './types.js';

export interface CapsuleHtmlInput {
  readonly report: CapsuleReportDocument;
}

/** Render a portable Capsule projection without reading or mutating evidence. */
export function renderCapsuleHtml(input: CapsuleHtmlInput): string {
  const { report } = input;
  const { artifactRoot: _artifactRoot, ...safeSession } = report.session;
  const data = JSON.stringify({ ...report, session: safeSession }).replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Capsule ${escapeHtml(report.session.sessionId)}</title>
<style>:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0d0d11}body{margin:0}.static-banner{padding:14px 24px;border-bottom:1px solid #30303c;color:#aaa4af;font-size:12px}#report{min-height:100vh}${capsuleReportClientView.styles}</style></head><body><div class="static-banner">Portable Capsule report · read-only offline snapshot · artifact paths remain hidden</div><div id="report"></div>
<script>const BlackboxReportViews=Object.create(null);${capsuleReportClientView.script}\nconst capsuleReportData=${data};BlackboxReportViews.capsule.render(document.getElementById('report'),capsuleReportData,{open:[],section:location.hash.slice(1)});</script></body></html>`;
}
