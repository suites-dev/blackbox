// Runs inside the Capsule client view, sharing its safe DOM helpers.
export const capsuleTimelineScript = `
function timelinePhase(stage){
  if(['admission','catalog','manager','catalog-load','catalog-resolution','manager-spawn','manager-handshake'].includes(stage))return 'Preparation';
  return ({acquisition:'Acquisition',readiness:'Application readiness',ready:'Capsule ready',persistence:'Recording'})[stage]||stage;
}
function timelineGroups(events){
  const groups=[];
  for(const event of events){
    const label=timelinePhase(event.stage),last=groups.at(-1);
    if(last&&last.label===label)last.events.push(event);
    else groups.push({label,events:[event]});
  }
  return groups;
}
function timelineEvent(event){
  const row=n('li','event'),body=n('div'),time=n('time','',date(event.at));
  row.dataset.eventSequence=String(event.sequence);time.dateTime=event.at;
  add(body,n('h3','',event.kind),p(eventText(event)),p(event.stage+' · event '+event.sequence));
  return add(row,n('span','event-dot'),body,time);
}
function timelineGroup(group,open){
  const first=group.events[0],last=group.events.at(-1),row=n('li','timeline-group panel');
  const details=n('details','timeline-disclosure');details.id='progress-group-'+first.sequence;
  details.open=open.includes(details.id);
  const summary=n('summary'),body=n('span','timeline-group-heading');summary.id=details.id+'-toggle';
  const range=group.events.length===1?'Event '+first.sequence:'Events '+first.sequence+'–'+last.sequence;
  add(body,n('strong','',group.label),n('span','timeline-group-meta',range+' · '+date(first.at)+(first.at===last.at?'':' → '+date(last.at))));
  const chevron=n('span','timeline-chevron','›');chevron.setAttribute('aria-hidden','true');
  add(summary,chevron,body,badge(group.events.length+' '+(group.events.length===1?'event':'events')));
  if(group.events.some(event=>event.kind==='capsule-start-failed'))add(body,badge('Failure recorded','bad'));
  const events=n('ol','timeline');for(const event of group.events)add(events,timelineEvent(event));
  add(details,summary,events);return add(row,details);
}
function timeline(d,open){
  const section=n('section','section');section.id='timeline';
  add(section,title('STARTUP · RETAINED EVENTS','Progress timeline','Expand a startup stage to inspect its events in recorded order. Docker health and application readiness remain separate.'));
  if(!d.progress.length)return add(section,p('No startup progress events were retained.','empty'));
  const list=n('ol','timeline-groups');
  for(const group of timelineGroups(d.progress))add(list,timelineGroup(group,open));
  return add(section,list);
}
`;
