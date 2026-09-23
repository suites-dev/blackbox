export const capsuleReportScript = `
(()=>{const links=[...document.querySelectorAll('[data-nav]')];
const publish=()=>parent.postMessage({kind:'capsule-report-state',hash:location.hash,scrollY:scrollY,open:[...document.querySelectorAll('details[open]')].map(x=>x.id)},'*');
const select=()=>{const id=location.hash.slice(1)||'overview';for(const link of links)link.classList.toggle('active',link.dataset.nav===id)};
for(const link of links)link.addEventListener('click',event=>{event.preventDefault();const id=link.dataset.nav;history.replaceState(null,'','#'+id);document.getElementById(id)?.scrollIntoView();select();publish()});
addEventListener('hashchange',()=>{select();publish()});let pending;
addEventListener('scroll',()=>{clearTimeout(pending);pending=setTimeout(publish,120)},{passive:true});
document.addEventListener('toggle',event=>{if(event.target instanceof HTMLDetailsElement)publish()},true);
addEventListener('message',event=>{const state=event.data;if(!state||state.kind!=='capsule-report-restore')return;
for(const item of state.open||[]){const node=document.getElementById(item);if(node instanceof HTMLDetailsElement)node.open=true}
if(state.hash)history.replaceState(null,'',state.hash);select();requestAnimationFrame(()=>scrollTo(0,Number(state.scrollY)||0))});
select();publish();})();
`;
