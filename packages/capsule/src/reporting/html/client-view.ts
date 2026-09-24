import { capsuleActivityListScript } from './activities/list.js';
import { capsuleActivityRowScript } from './activities/row.js';
import { capsuleRenderScript } from './shell/render.js';
import { capsuleBindNavigationScript } from './shell/bind-navigation.js';
import { capsuleShellScript } from './shell-view.js';
import { capsuleReportStyles } from './styles.js';
import { capsuleTimelineScript } from './timeline-view.js';

export const capsuleReportClientView = {
  kind: 'report-client-view' as const,
  styles: capsuleReportStyles,
  script: `
(()=>{const V=BlackboxReportViews;
const n=(tag,className,text)=>{const x=document.createElement(tag);if(className)x.className=className;if(text!==undefined)x.textContent=String(text);return x};
const add=(parent,...children)=>{parent.append(...children.filter(Boolean));return parent};
const badge=(text,tone='neutral')=>n('span','badge '+tone,text);
const p=(text,className='')=>n('p',className,text);
const title=(eyebrow,heading,description)=>{const head=n('div','section-head'),left=n('div');add(left,p(eyebrow,'eyebrow'),n('h2','',heading));add(head,left,p(description));return head};
const available=value=>value&&value.kind==='available';
const date=value=>{const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?String(value):parsed.toISOString().replace('T',' ').replace('.000Z',' UTC')};
function assertReport(d){if(!d||d.kind!=='capsule-operational-report'||d.schemaVersion!==1||!d.session||!Array.isArray(d.progress)||!Array.isArray(d.activities)||!Array.isArray(d.activityTelemetry)||!d.resources)throw new Error('Invalid Capsule report document.')}
function navLink(id,label,count,glyph){const link=n('a','');link.href='#'+id;link.dataset.reportNav=id;add(link,icon(glyph),n('span','nav-label',label));if(count!==null)add(link,n('span','nav-count',count));return link}
${capsuleShellScript}
function hero(d){const x=n('section','report-hero');const hasDescription=d.session.description.kind==='provided';add(x,p('CAPSULE · OPERATIONAL EXPERIMENT','eyebrow'),n('h1','',d.session.title),p(d.session.sessionId,'session-id'),p(hasDescription?d.session.description.value:'No description was recorded for this session.',hasDescription?'lede':'lede muted'));const meta=n('div','hero-meta');for(const [label,value] of [['System',d.session.system],['Admitted',date(d.session.admittedAt)],['Updated',date(d.session.updatedAt)]]){const item=n('span','',label+' ');add(item,n('strong','',value));add(meta,item)}add(x,meta);return x}
function metrics(d){const x=n('div','metrics');for(const [value,label] of [[d.activities.length,'recorded activities'],[d.progress.length,'startup events'],[d.resources.containers.length,'containers'],[d.redactions.count,'redactions applied']]){const item=n('div','metric');add(item,n('strong','',value),n('span','',label));add(x,item)}return x}
function summaryCard(name){const card=n('div','summary-card');add(card,n('h3','',name));return card}
function overview(d){const section=n('section','section');section.id='overview';add(section,title('CURRENT RECORD','Session overview','Lifecycle, readiness, telemetry, and cleanup come from distinct retained fields.'));const grid=n('div','panel summary-grid');const lifecycle=summaryCard('Lifecycle');const tone=d.lifecycle.kind==='running'?'good':d.lifecycle.kind==='failed'?'bad':d.lifecycle.kind==='starting'?'warn':'neutral';add(lifecycle,badge(d.lifecycle.kind,tone),p('Retained state '+d.session.retainedState),p('Compose project '+(available(d.composeProject)?d.composeProject.value:'not available')));const readiness=summaryCard('Entrypoint & readiness');if(available(d.readiness))add(readiness,badge(d.readiness.value.status,'good'),p(d.readiness.value.url+' · '+d.readiness.value.durationMs+'ms'));else add(readiness,badge('Unavailable'),p('No application readiness result was retained.'));add(readiness,p('Entrypoint '+(available(d.entrypoint)?d.entrypoint.value.url:'not available')));const telemetry=summaryCard('Observations');if(d.observations.kind==='collector-session-found'){const received=d.observations.telemetry.status==='received';add(telemetry,badge(received?'received':'not received',received?'good':'warn'),p(d.observations.telemetry.acceptedSpans+' spans · '+d.observations.traceIds.length+' traces'),p(d.observations.activations.length+' instrumentation activations'));}else if(d.observations.kind==='collector-session-corrupt')add(telemetry,badge('corrupt','bad'),p(d.observations.error.name+': '+d.observations.error.message));else add(telemetry,badge('not retained','warn'),p(d.observations.message));const cleanup=summaryCard('Cleanup');if(d.cleanup.kind==='failed')add(cleanup,badge('failed','bad'),p(d.cleanup.error.name+': '+d.cleanup.error.message));else add(cleanup,badge(d.cleanup.kind,d.cleanup.kind==='complete'?'good':'neutral'));add(cleanup,p('Artifact path [redacted]'));add(grid,lifecycle,readiness,telemetry,cleanup);add(section,grid);return section}
function acquisition(o){if(o.kind==='service-state'){const exit=o.container.termination.kind==='exited'?' · exit '+o.container.termination.exitCode:'';return o.participant+' · '+o.container.service+' · '+o.container.state+' · health '+o.container.health+exit}if(o.kind==='resource-discovered')return o.resource.kind+' · '+o.resource.name;if(o.kind==='waiting')return 'Waiting for acquisition · '+o.elapsedMs+'ms elapsed';return 'Docker observation '+o.status}
function eventText(e){switch(e.kind){case'session-admitted':return 'System '+e.system+' admitted; environment values are not included.';case'catalog-selected':return 'Selected system '+e.system+'.';case'catalog-resolved':return e.services.length+' services resolved.';case'manager-spawned':case'manager-ready':return 'Manager process '+e.managerPid+'.';case'compose-configured':case'acquisition-started':return 'Compose project '+e.projectName+'.';case'container-acquired':return e.participant+' · '+e.service+' · '+e.containerName+'.';case'endpoint-mapped':return e.endpoint.url;case'resource-owned':return e.resource.kind+' · '+e.resource.name+'.';case'readiness-started':return e.url+' · timeout '+e.timeoutMs+'ms.';case'readiness-succeeded':return e.url+' · ready after '+e.durationMs+'ms.';case'capsule-ready':return 'Capsule ready after '+e.durationMs+'ms.';case'capsule-start-failed':return e.cause.name+': '+e.cause.message;case'acquisition-observation':return acquisition(e.observation);default:return 'Unsupported retained event.'}}
${capsuleTimelineScript}



function resourceColumn(label,items){const column=n('div','resource-column');add(column,n('h3','',label));if(!items.length)add(column,p('None recorded.','muted'));for(const item of items)add(column,item);return column}
function resources(d){const section=n('section','section');section.id='resources';add(section,title('ACQUIRED INFRASTRUCTURE','Resources','Resource identities are operational facts retained by Capsule. Their presence makes no claim about application behavior.'));const grid=n('div','panel resource-grid');const containers=d.resources.containers.map(c=>{const item=n('div','resource-item');add(item,n('strong','',c.participant),n('span','',c.service+' · '+c.containerName),n('span','','ID '+c.containerId+' · host '+c.host),n('span','',c.networkNames.join(' · ')||'No networks recorded'));return item});const strings=values=>values.map(value=>add(n('div','resource-item'),n('strong','',value)));add(grid,resourceColumn('Containers',containers),resourceColumn('Networks',strings(d.resources.networks)),resourceColumn('Volumes',strings(d.resources.volumes)));add(section,grid);return section}
function placeholder(id,eyebrow,heading,copy,label,comment){const section=n('section','panel placeholder');section.id=id;section.append(document.createComment(comment));const body=n('div');add(body,p(eyebrow,'eyebrow'),n('h2','',heading),p(copy));add(section,body,badge(label));return section}


${capsuleBindNavigationScript}
${capsuleRenderScript}
${capsuleActivityRowScript}
${capsuleActivityListScript}
V.capsule={render};})();
`,
};
