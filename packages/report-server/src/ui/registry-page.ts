import type { ReportSelection } from '../model/server.js';
import type { ReportProvider } from '../model/provider.js';
import { REGISTRY_SCRIPT } from './registry-script.js';
import { REGISTRY_STYLES } from './registry-styles.js';

export function renderRegistryPage(input: {
  readonly providers: readonly ReportProvider[];
}): string {
  const viewStyles = input.providers.map((provider) => provider.view.styles).join('\n');
  const viewScripts = input.providers.map((provider) => provider.view.script).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Blackbox experiments</title><style>${REGISTRY_STYLES}</style></head><body>
<a class="skip" href="#registry-content">Skip to experiments</a><header><a class="brand" href="/" aria-label="Blackbox experiment registry"><span aria-hidden="true">B</span>BLACKBOX</a><p>Capsule registry</p><button id="refresh" type="button">Refresh <span aria-hidden="true">↻</span></button></header>
<main id="registry-content"><section id="registry-view"><section class="hero"><p class="eyebrow">CAPSULE · EXPERIMENT REGISTRY</p><h1>Experiments</h1><p>Browse live and retained Capsule sessions. Select an exact session to open its read-only operational report. Viewing a report never runs a command or changes its evidence.</p><div class="stats" aria-label="Registry summary"><span><strong id="total-count">—</strong>experiments</span><span><strong id="running-count">—</strong>running</span><span><strong id="stopped-count">—</strong>stopped</span><span><strong id="failed-count">—</strong>failed</span></div></section>
<section class="browser" aria-label="Experiment browser"><aside><div class="aside-head"><div><p class="eyebrow">DISCOVERY</p><h2>Sessions</h2></div><p id="status" role="status" aria-atomic="true">Connecting…</p></div><label class="search"><span>Search experiments</span><input id="search" type="search" placeholder="Title, session ID, or type" autocomplete="off"></label><div class="controls"><div role="group" aria-label="Filter by session state"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="running" aria-pressed="false">Running</button><button type="button" data-filter="stopped" aria-pressed="false">Stopped</button><button type="button" data-filter="failed" aria-pressed="false">Failed</button></div><label>Sort <select id="sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option></select></label></div><p id="result-count" class="result-count"></p><ul id="reports"></ul></aside></section></section>
<section id="report-view" class="detail" aria-label="Selected experiment" hidden><div class="report-toolbar"><a id="back-to-registry" href="/">← Back to experiments</a><div id="detail-status" class="detail-status" role="status" aria-atomic="true"></div></div><div id="empty" hidden></div><div id="report" hidden></div></section></main>
<footer>Blackbox · read-only local report browser · Capsule observations only</footer><style>${viewStyles}</style><script>const BlackboxReportViews=Object.create(null);${viewScripts}</script><script>${REGISTRY_SCRIPT}</script></body></html>`;
}

export function selectionQuery(input: { selection: ReportSelection }): string {
  if (input.selection.kind === 'registry') {
    return '';
  }
  return `?${new URLSearchParams({ type: input.selection.type, id: input.selection.id }).toString()}`;
}
