export const capsuleTimelineStyles = `
.timeline-groups{display:grid;gap:14px;margin:0;padding:0;list-style:none}
.timeline-disclosure>summary{display:flex;align-items:center;gap:18px;min-height:88px;padding:20px 24px;cursor:pointer;list-style:none}
.timeline-disclosure>summary::-webkit-details-marker{display:none}
.timeline-disclosure>summary:hover{background:var(--raised)}
.timeline-disclosure>summary:focus-visible{outline:3px solid var(--pink-soft);outline-offset:-4px;border-radius:16px}
.timeline-chevron{flex:none;color:var(--pink);font-size:28px;line-height:1;transition:transform .15s}
.timeline-disclosure[open]>summary .timeline-chevron{transform:rotate(90deg)}
.timeline-group-heading{display:grid;flex:1;gap:7px;min-width:0}
.timeline-group-heading>strong{font-size:20px}
.timeline-group-meta{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.timeline-group-heading>.badge{justify-self:start}
.timeline-disclosure>summary>.badge{flex:none}
.timeline-disclosure>.timeline{border-top:1px solid var(--line)}
@media(max-width:560px){.timeline-disclosure>summary{gap:12px;padding:18px 14px;flex-wrap:wrap}.timeline-group-heading{flex-basis:calc(100% - 32px)}.timeline-disclosure>summary>.badge{margin-left:26px}.timeline-group-heading>strong{font-size:19px}}
@media(prefers-reduced-motion:reduce){.timeline-chevron{transition:none}}
`;
