interface ActivityArrivalElement {
  readonly dataset: { readonly activityId: string };
  readonly classList: { add(name: string): void; remove(name: string): void };
  addEventListener(type: 'animationend', listener: () => void, options: { once: true }): void;
}

interface ActivityArrivalRoot {
  querySelectorAll(selector: '[data-activity-id]'): Iterable<ActivityArrivalElement>;
}

type ClearArrival = (handler: () => void, timeout: number) => unknown;

export function activityIds(reportDocument: unknown): readonly string[] {
  if (
    typeof reportDocument !== 'object' ||
    reportDocument === null ||
    !('activities' in reportDocument) ||
    !Array.isArray(reportDocument.activities)
  ) {
    return [];
  }
  const activities: readonly unknown[] = reportDocument.activities;
  const result = new Set<string>();
  for (const activity of activities) {
    if (typeof activity === 'object' && activity !== null && 'activityId' in activity) {
      const activityId: unknown = activity.activityId;
      if (typeof activityId === 'string') {
        result.add(activityId);
      }
    }
  }
  return [...result];
}

export function arrivedActivityIds(previous: unknown, next: unknown): readonly string[] {
  if (previous === null) {
    return [];
  }
  const previousIds = new Set(activityIds(previous));
  return activityIds(next).filter((activityId) => !previousIds.has(activityId));
}

export function markActivityArrivals(
  root: ActivityArrivalRoot,
  activityIds: readonly string[],
  clearAfter: ClearArrival = setTimeout,
): void {
  if (activityIds.length === 0) {
    return;
  }
  const arrivals = new Set(activityIds);
  for (const element of root.querySelectorAll('[data-activity-id]')) {
    const activityId = element.dataset.activityId;
    if (!arrivals.has(activityId)) {
      continue;
    }
    const clear = () => {
      element.classList.remove('activity-arrived');
    };
    element.classList.add('activity-arrived');
    element.addEventListener('animationend', clear, { once: true });
    clearAfter(clear, 2000);
  }
}

// Generic polling and navigation. Provider client views own report interpretation and DOM.
export const REGISTRY_SCRIPT = `
${activityIds.toString()}
${arrivedActivityIds.toString()}
${markActivityArrivals.toString()}
if('scrollRestoration'in history)history.scrollRestoration='manual';
const elements={list:document.getElementById('reports'),status:document.getElementById('status'),detailStatus:document.getElementById('detail-status'),report:document.getElementById('report'),empty:document.getElementById('empty'),search:document.getElementById('search'),sort:document.getElementById('sort'),registryView:document.getElementById('registry-view'),reportView:document.getElementById('report-view'),back:document.getElementById('back-to-registry')};
const state={selection:null,reports:[],registryBytes:'',reportBytes:'',reportDocument:null,filter:'all',search:'',sort:'newest',refreshing:false,timer:null,request:null,revision:0,registryScroll:0,reportStates:new Map()};
const key=value=>value.type+':'+value.id;const failed=value=>value==='failed'||value.endsWith('-failed');
function selectionFromUrl(){const query=new URL(location.href).searchParams;return query.has('type')&&query.has('id')?{type:query.get('type'),id:query.get('id')}:null}
function matches(report){const filter=state.filter==='all'||(state.filter==='failed'?failed(report.state):report.state===state.filter);const description=report.description.kind==='available'?report.description.value:'';return filter&&[report.title,report.id,report.type,report.state,description].join(' ').toLowerCase().includes(state.search.toLowerCase())}
function sortedReports(){const reports=state.reports.filter(matches);reports.sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title):(state.sort==='oldest'?1:-1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));return reports}
function text(tag,className,value){const node=document.createElement(tag);node.className=className;node.textContent=value;return node}
function reportLink(report){const li=document.createElement('li'),link=document.createElement('a');link.className='report-link';link.href='?'+new URLSearchParams({type:report.type,id:report.id});link.setAttribute('aria-current',String(state.selection!==null&&key(state.selection)===key(report)));const dot=text('span','state-dot '+report.state,'');dot.setAttribute('aria-hidden','true');const body=document.createElement('span');body.append(text('span','report-title',report.title),text('span','report-id',report.id+' · '+report.type));if(report.description.kind==='available')body.append(text('span','report-desc',report.description.value));const side=document.createElement('span');side.append(text('span','report-state',report.state),text('span','report-id',new Date(report.createdAt).toLocaleString()));link.append(dot,body,side);link.addEventListener('click',event=>{event.preventDefault();navigate({type:report.type,id:report.id})});li.append(link);return li}
function renderList(){const reports=sortedReports();elements.list.replaceChildren(...reports.map(reportLink));document.getElementById('result-count').textContent=reports.length+' of '+state.reports.length+' experiments';if(!reports.length)elements.list.append(text('li','registry-empty','No matching experiments. Change the search or state filter.'));for(const [id,count] of [['total-count',state.reports.length],['running-count',state.reports.filter(item=>item.state==='running').length],['stopped-count',state.reports.filter(item=>item.state==='stopped').length],['failed-count',state.reports.filter(item=>failed(item.state)).length]])document.getElementById(id).textContent=String(count)}
function captureReportState(){if(state.selection===null)return;const saved=state.reportStates.get(key(state.selection))||{};const urlSelection=selectionFromUrl();const section=urlSelection!==null&&key(urlSelection)===key(state.selection)?location.hash.slice(1):saved.section;state.reportStates.set(key(state.selection),{open:[...elements.report.querySelectorAll('details[open]')].map(node=>node.id),scrollY,section})}
function setSelection(selection,captured=false){const previous=state.selection;if(!captured){if(previous===null&&selection!==null)state.registryScroll=scrollY;captureReportState()}state.request?.abort();state.request=null;state.selection=selection;state.reportBytes='';state.reportDocument=null;state.revision+=1;elements.registryView.hidden=selection!==null;elements.reportView.hidden=selection===null;elements.report.hidden=true;elements.report.replaceChildren();elements.empty.hidden=true;elements.detailStatus.textContent=selection===null?'':'Loading '+selection.id+'…';renderList();if(selection===null)requestAnimationFrame(()=>requestAnimationFrame(()=>scrollTo(0,state.registryScroll)));else if(previous===null||key(previous)!==key(selection))scrollTo(0,0)}
function navigate(selection){if(state.selection===null&&selection!==null)state.registryScroll=scrollY;captureReportState();const url=new URL(location.href);url.hash='';url.search=selection===null?'':new URLSearchParams({type:selection.type,id:selection.id});history.pushState(null,'',url);setSelection(selection,true);void refresh()}
async function read(url,signal){const timeout=AbortSignal.timeout(5000),requestSignal=signal===undefined?timeout:AbortSignal.any([signal,timeout]);const response=await fetch(url,{cache:'no-store',signal:requestSignal});if(!response.ok)throw new Error('Request failed ('+response.status+')');return response}
async function refreshRegistry(){try{const data=await(await read('/api/reports')).json(),bytes=JSON.stringify(data);if(bytes!==state.registryBytes){state.reports=data.reports;state.registryBytes=bytes;renderList()}elements.status.textContent='Connected · '+data.reports.length+' sessions · checked '+new Date().toLocaleTimeString()+(data.failures.length?' · '+data.failures.length+' provider failures':'')}catch{elements.status.textContent='Updates unavailable. Displayed sessions may be stale. Retrying…'}}
function focusState(){const active=document.activeElement;if(!(active instanceof Element)||!elements.report.contains(active))return null;const focusable=[...elements.report.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')];return active.id?{kind:'id',value:active.id}:active.dataset.reportNav?{kind:'nav',value:active.dataset.reportNav}:{kind:'index',value:focusable.indexOf(active)}}
function restoreFocus(saved){if(saved===null)return;const focusable=[...elements.report.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')];const target=saved.kind==='id'?elements.report.querySelector('#'+CSS.escape(saved.value)):saved.kind==='nav'?elements.report.querySelector('[data-report-nav="'+CSS.escape(saved.value)+'"]'):focusable[saved.value];target?.focus({preventScroll:true})}
function renderDocument(current,document,bytes,arrivals){const view=BlackboxReportViews[current.type];if(!view||typeof view.render!=='function')throw new Error('No compatible report view.');const prior=state.reportStates.get(key(current))||{open:[],section:location.hash.slice(1)};const mounted=elements.report.childElementCount>0;const saved=mounted?{open:[...elements.report.querySelectorAll('details[open]')].map(node=>node.id),scrollY,section:location.hash.slice(1)||prior.section}:prior;const y=saved.scrollY??scrollY,focus=mounted?focusState():null;state.reportStates.set(key(current),saved);view.render(elements.report,document,saved);markActivityArrivals(elements.report,arrivals);state.reportBytes=bytes;state.reportDocument=document;elements.report.hidden=false;elements.empty.hidden=true;requestAnimationFrame(()=>{if(state.selection===current){restoreFocus(focus);scrollTo(0,y)}})}
async function refreshReport(){const current=state.selection;if(current===null)return;const revision=state.revision;state.request?.abort();const controller=new AbortController();state.request=controller;try{const result=await(await read('/api/reports/'+encodeURIComponent(current.type)+'/'+encodeURIComponent(current.id),controller.signal)).json();if(revision!==state.revision||current!==state.selection)return;if(result.kind!=='report-document')throw new Error('Invalid report response.');const bytes=JSON.stringify(result.document);if(bytes!==state.reportBytes)renderDocument(current,result.document,bytes,arrivedActivityIds(state.reportDocument,result.document));elements.detailStatus.textContent='Following '+current.id+' · recorded updates refresh automatically'}catch(error){if(controller.signal.aborted||revision!==state.revision)return;elements.detailStatus.textContent='Cannot update '+current.id+'. '+(state.reportBytes?'Showing the last snapshot; it may be stale.':'No compatible report is available.')+' Retrying…'}finally{if(state.request===controller)state.request=null}}
async function refresh(){if(state.refreshing)return;clearTimeout(state.timer);state.refreshing=true;try{await Promise.all([refreshRegistry(),refreshReport()])}finally{state.refreshing=false;state.timer=setTimeout(refresh,1000)}}
document.getElementById('refresh').addEventListener('click',()=>void refresh());elements.back.addEventListener('click',event=>{event.preventDefault();navigate(null)});elements.search.addEventListener('input',event=>{state.search=event.target.value;renderList()});elements.sort.addEventListener('change',event=>{state.sort=event.target.value;renderList()});document.addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;state.filter=button.dataset.filter;for(const item of document.querySelectorAll('[data-filter]'))item.setAttribute('aria-pressed',String(item===button));renderList()});addEventListener('popstate',()=>{setSelection(selectionFromUrl());void refresh()});
elements.report.addEventListener('click',event=>{if(event.target.closest('[data-report-nav]'))requestAnimationFrame(captureReportState)});
setSelection(selectionFromUrl());void refresh();
`;
