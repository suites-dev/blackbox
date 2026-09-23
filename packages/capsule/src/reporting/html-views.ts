import type { CapsuleProgressEvent } from '../types.js';
import { escapeHtml, formatDate } from './html-format.js';
import type { CapsuleReportActivity, CapsuleReportDocument } from './types.js';

const badge = (text: string, tone: string): string => `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
const unavailable = '<span class="badge neutral">Unavailable</span>';
const empty = (text: string): string => `<div class="empty">${escapeHtml(text)}</div>`;

function lifecycleBadge(report: CapsuleReportDocument): string {
  const tone = report.lifecycle.kind === 'running' ? 'good'
    : report.lifecycle.kind === 'failed' ? 'bad' : report.lifecycle.kind === 'starting' ? 'warn' : 'neutral';
  return badge(report.lifecycle.kind, tone);
}

function cleanupContent(report: CapsuleReportDocument): string {
  if (report.cleanup.kind === 'failed') {
    return `${badge('failed', 'bad')}<p>${escapeHtml(report.cleanup.error.name)}: ${escapeHtml(report.cleanup.error.message)}</p>`;
  }
  return badge(report.cleanup.kind, report.cleanup.kind === 'complete' ? 'good' : 'neutral');
}

export function renderOverview(report: CapsuleReportDocument): string {
  const compose = report.composeProject.kind === 'available' ? escapeHtml(report.composeProject.value) : 'not available';
  const entry = report.entrypoint.kind === 'available' ? escapeHtml(report.entrypoint.value.url) : 'not available';
  const readiness = report.readiness.kind === 'available'
    ? `${badge(report.readiness.value.status, 'good')}<p>${escapeHtml(report.readiness.value.url)} · ${String(report.readiness.value.durationMs)}ms</p>`
    : `${unavailable}<p>No application readiness result was retained.</p>`;
  return `<div class="metrics"><div class="metric"><strong>${String(report.activities.length)}</strong><span>recorded activities</span></div><div class="metric"><strong>${String(report.progress.length)}</strong><span>startup events</span></div><div class="metric"><strong>${String(report.resources.containers.length)}</strong><span>containers</span></div><div class="metric"><strong>${String(report.redactions.count)}</strong><span>redactions applied</span></div></div>
<section class="section"><div class="section-head"><div><p class="eyebrow">CURRENT RECORD</p><h2>Session overview</h2></div><p>Lifecycle and readiness come from distinct retained fields. Container health never substitutes for application readiness.</p></div><div class="panel summary-grid"><div class="summary-card"><h3>Lifecycle</h3>${lifecycleBadge(report)}<p>Retained state <strong>${escapeHtml(report.session.retainedState)}</strong></p><p>Compose project <strong>${compose}</strong></p></div><div class="summary-card"><h3>Entrypoint &amp; readiness</h3>${readiness}<p>Entrypoint <strong>${entry}</strong></p></div><div class="summary-card"><h3>Cleanup</h3>${cleanupContent(report)}<p>Artifact path <strong>[redacted]</strong></p></div></div></section>`;
}

function acquisitionDescription(event: Extract<CapsuleProgressEvent, { kind: 'acquisition-observation' }>): string {
  const observation = event.observation;
  if (observation.kind === 'service-state') {
    const termination = observation.container.termination.kind === 'exited'
      ? ` · exit ${String(observation.container.termination.exitCode)}` : '';
    return `${observation.participant} · ${observation.container.service} · ${observation.container.state} · health ${observation.container.health}${termination}`;
  }
  if (observation.kind === 'resource-discovered') {
    return `${observation.resource.kind} · ${observation.resource.name}`;
  }
  if (observation.kind === 'waiting') {
    return `Waiting for acquisition · ${String(observation.elapsedMs)}ms elapsed`;
  }
  return `Docker observation ${observation.status}`;
}

function progressDescription(event: CapsuleProgressEvent): string {
  switch (event.kind) {
    case 'session-admitted': return `System ${event.system} admitted; environment values are not included.`;
    case 'catalog-selected': return `Selected system ${event.system}.`;
    case 'catalog-resolved': return `${String(event.services.length)} services resolved.`;
    case 'manager-spawned': case 'manager-ready': return `Manager process ${String(event.managerPid)}.`;
    case 'compose-configured': case 'acquisition-started': return `Compose project ${event.projectName}.`;
    case 'container-acquired': return `${event.participant} · ${event.service} · ${event.containerName}.`;
    case 'endpoint-mapped': return event.endpoint.url;
    case 'resource-owned': return `${event.resource.kind} · ${event.resource.name}.`;
    case 'readiness-started': return `${event.url} · timeout ${String(event.timeoutMs)}ms.`;
    case 'readiness-succeeded': return `${event.url} · ready after ${String(event.durationMs)}ms.`;
    case 'capsule-ready': return `Capsule ready after ${String(event.durationMs)}ms.`;
    case 'capsule-start-failed': return `${event.cause.name}: ${event.cause.message}`;
    case 'acquisition-observation': return acquisitionDescription(event);
  }
}

export function renderTimeline(report: CapsuleReportDocument): string {
  const events = report.progress.map((event) => `<li class="event"><span class="event-dot" aria-hidden="true"></span><div><h3>${escapeHtml(event.kind)}</h3><p>${escapeHtml(progressDescription(event))}</p><p>${escapeHtml(event.stage)} · event ${String(event.sequence)}</p></div><time datetime="${escapeHtml(event.at)}">${formatDate(event.at)}</time></li>`).join('');
  return `<section class="section" id="timeline"><div class="section-head"><div><p class="eyebrow">STARTUP · RETAINED EVENTS</p><h2>Progress timeline</h2></div><p>Docker service state and health are acquisition observations. Application readiness is reported only by readiness events.</p></div><ol class="panel timeline">${events || empty('No startup progress events were retained.')}</ol></section>`;
}

function outcomeBadge(activity: CapsuleReportActivity): string {
  if (activity.outcome.kind === 'signaled') {
    return badge(`signal ${activity.outcome.signal}`, 'bad');
  }
  return badge(`exit ${String(activity.outcome.exitCode)}`, activity.outcome.exitCode === 0 ? 'good' : 'bad');
}

function activityRow(activity: CapsuleReportActivity): string {
  const target = activity.target === 'host' ? 'Host' : `Participant · ${activity.participant ?? 'not recorded'}`;
  const command = activity.argv.map((value) => JSON.stringify(value)).join(' ');
  const output = activity.outcome.stdout || '(no standard output)';
  const error = activity.outcome.stderr || '(no standard error)';
  return `<details class="activity" id="activity-${String(activity.sequence)}"><summary><span class="sequence">${String(activity.sequence).padStart(2, '0')}</span><span><span class="activity-title">${escapeHtml(command || '(empty command)')}</span><span class="muted"> · ${escapeHtml(target)}</span></span>${outcomeBadge(activity)}</summary><div class="activity-body"><p class="muted">${formatDate(activity.startedAt)} → ${formatDate(activity.completedAt)}</p><h4>Command</h4><pre>${escapeHtml(command)}</pre><h4>Standard output</h4><pre>${escapeHtml(output)}</pre><h4>Standard error</h4><pre>${escapeHtml(error)}</pre></div></details>`;
}

export function renderActivitySection(report: CapsuleReportDocument): string {
  return `<section class="section" id="activities"><div class="section-head"><div><p class="eyebrow">RECORDED INVOCATIONS</p><h2>Activity inspector</h2></div><p>Commands and process outcomes are shown exactly as retained after report redaction. Expand an activity to inspect its streams.</p></div><div class="panel">${report.activities.map(activityRow).join('') || empty('No activities were recorded for this session.')}</div></section>`;
}

function stringItems(items: readonly string[], emptyText: string): string {
  return items.map((item) => `<div class="resource-item"><strong>${escapeHtml(item)}</strong></div>`).join('') || `<p class="muted">${emptyText}</p>`;
}

export function renderResourceSection(report: CapsuleReportDocument): string {
  const containers = report.resources.containers.map((item) => `<div class="resource-item"><strong>${escapeHtml(item.participant)}</strong><span>${escapeHtml(item.service)} · ${escapeHtml(item.containerName)}</span><span>ID ${escapeHtml(item.containerId)} · host ${escapeHtml(item.host)}</span><span>${item.networkNames.map(escapeHtml).join(' · ') || 'No networks recorded'}</span></div>`).join('');
  return `<section class="section" id="resources"><div class="section-head"><div><p class="eyebrow">ACQUIRED INFRASTRUCTURE</p><h2>Resources</h2></div><p>Resource identities are operational facts retained by Capsule. Their presence makes no claim about application behavior.</p></div><div class="panel resource-grid"><div class="resource-column"><h3>Containers</h3>${containers || '<p class="muted">No containers recorded.</p>'}</div><div class="resource-column"><h3>Networks</h3>${stringItems(report.resources.networks, 'No networks recorded.')}</div><div class="resource-column"><h3>Volumes</h3>${stringItems(report.resources.volumes, 'No volumes recorded.')}</div></div></section>`;
}
