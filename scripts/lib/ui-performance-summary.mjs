// Offline lab analysis only. No browser control, collection endpoint or I/O.
// CDP PerformanceTimeline timestamps are seconds since Epoch. DOM timings are ms.
// Protocol: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/PerformanceTimeline.pdl
// Session windows: https://web.dev/articles/cls
export const PERFORMANCE_SAMPLE_LIMITS = Object.freeze({events:2000, visibilityEntries:128, durationMs:60000});
const knownTypes=new Set(['largest-contentful-paint','layout-shift']);
const fail=code=>{const error=new Error('UI_PERFORMANCE_'+code);error.code=error.message;throw error;};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=(value,min,max,code)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(code);return value;};
const boolean=(value,code)=>{if(typeof value!=='boolean')fail(code);return value;};
const frame=value=>{if(typeof value!=='string'||!value.length||value.length>128)fail('INVALID_FRAME_SELECTION');return value;};
const relativeMs=(seconds,origin)=>{
 number(seconds,0,Number.MAX_SAFE_INTEGER/1000,'INVALID_EPOCH_SECONDS');
 // A CDP buffer may contain the previous document, but DOM milliseconds or
 // Epoch milliseconds must not silently look like an empty, zero-CLS sample.
 if(!seconds||Math.abs(seconds-origin/1000)>86400)fail('INVALID_EPOCH_SECONDS');
 return Math.round((seconds*1000-origin)*100)/100;
};

/**
 * sample.events contains native PerformanceTimeline `params.event` objects.
 * Select the current Page.getFrameTree().frameTree.frame.id in memory; it is
 * never returned. Unknown fields, URLs, DOM IDs and attribution are discarded.
 * This is a bounded main-document snapshot, not final/field Core Web Vitals.
 */
export function summarizePerformanceSample(sample,{mainFrameId}={}){
 if(!record(sample))fail('INVALID_SAMPLE');frame(mainFrameId);
 const origin=number(sample.timeOriginEpochMs,1e12,Number.MAX_SAFE_INTEGER,'INVALID_TIME_ORIGIN_MS');
 const end=number(sample.sampledAtMs,0.01,PERFORMANCE_SAMPLE_LIMITS.durationMs,'INVALID_SAMPLE_DURATION_MS');
 const activation=number(sample.activationStartMs,0,PERFORMANCE_SAMPLE_LIMITS.durationMs,'INVALID_ACTIVATION_MS');
 if(!['navigate','reload','back_forward','unknown'].includes(sample.navigationType))fail('INVALID_NAVIGATION_TYPE');
 if(!['visible','hidden','unknown'].includes(sample.currentVisibility))fail('INVALID_VISIBILITY_STATE');
 if(!Array.isArray(sample.supportedEntryTypes)||sample.supportedEntryTypes.length>128||sample.supportedEntryTypes.some(type=>typeof type!=='string'||type.length>128))fail('INVALID_SUPPORTED_TYPES');
 if(!Array.isArray(sample.events)||sample.events.length>PERFORMANCE_SAMPLE_LIMITS.events)fail('EVENT_LIMIT');
 const truncated=boolean(sample.truncated,'INVALID_CAPTURE_STATE'),hasMore=boolean(sample.hasMore,'INVALID_CAPTURE_STATE');
 const complete=!truncated&&!hasMore;
 const support={lcp:sample.supportedEntryTypes.includes('largest-contentful-paint'),cls:sample.supportedEntryTypes.includes('layout-shift'),visibility:sample.supportedEntryTypes.includes('visibility-state')};
 const states=sample.visibilityEntries??[];
 if(!Array.isArray(states)||states.length>PERFORMANCE_SAMPLE_LIMITS.visibilityEntries)fail('INVALID_VISIBILITY_HISTORY');
 const visibility=states.map(entry=>{
  if(!record(entry)||!['visible','hidden'].includes(entry.name))fail('INVALID_VISIBILITY_HISTORY');
  return {state:entry.name,time:number(entry.startTime,0,end,'INVALID_VISIBILITY_TIME_MS')};
 });
 const initialStates=new Set(visibility.filter(entry=>entry.time===0).map(entry=>entry.state));
 const initial=support.visibility&&initialStates.size===1?[...initialStates][0]:'unknown';
 const ineligible=[],unknown=[];
 if(sample.navigationType==='back_forward')ineligible.push('BACK_FORWARD_NAVIGATION');
 if(activation>0)ineligible.push('PRERENDER_ACTIVATION');
 if(initial==='hidden')ineligible.push('INITIALLY_HIDDEN');
 if(visibility.some(entry=>entry.state==='hidden'&&entry.time>0))ineligible.push('HIDDEN_DURING_SAMPLE');
 if(sample.currentVisibility==='hidden')ineligible.push('CURRENTLY_HIDDEN');
 if(sample.navigationType==='unknown')unknown.push('NAVIGATION_UNKNOWN');
 if(sample.currentVisibility==='unknown')unknown.push('CURRENT_VISIBILITY_UNKNOWN');
 if(!support.visibility)unknown.push('VISIBILITY_HISTORY_UNSUPPORTED');
 else if(initial==='unknown')unknown.push('INITIAL_VISIBILITY_UNKNOWN');
 if(!complete)unknown.push('CAPTURE_INCOMPLETE');
 const sampleEligible=!ineligible.length&&!unknown.length;
 const lcp=[],shifts=[];let ignoredFrames=0,outsideWindow=0,unavailableLcpTimes=0;
 for(const entry of sample.events){
  if(!record(entry))fail('INVALID_EVENT');
  // The protocol permits an empty frameId for non-frame targets. It cannot
  // match the selected document, so ignore it before inspecting its details.
  if(typeof entry.frameId!=='string'||entry.frameId.length>128)fail('INVALID_FRAME_SELECTION');
  if(entry.frameId!==mainFrameId){ignoredFrames++;continue;}
  if(!knownTypes.has(entry.type))fail('INVALID_EVENT_TYPE');
  const time=relativeMs(entry.time,origin);
  if(time<0||time>end){outsideWindow++;continue;}
  if(entry.type==='largest-contentful-paint'){
   const details=entry.lcpDetails;if(!record(details))fail('INVALID_LCP_DETAILS');
   const render=number(details.renderTime,0,Number.MAX_SAFE_INTEGER/1000,'INVALID_EPOCH_SECONDS');
   const load=number(details.loadTime,0,Number.MAX_SAFE_INTEGER/1000,'INVALID_EPOCH_SECONDS');
   if(render)relativeMs(render,origin);if(load)relativeMs(load,origin);
   if(!render&&!load){unavailableLcpTimes++;continue;}
   const candidate=relativeMs(render||load,origin);
   if(candidate<0||candidate>end){outsideWindow++;continue;}
   lcp.push({time,value:candidate});
  }else{
   const details=entry.layoutShiftDetails;if(!record(details))fail('INVALID_SHIFT_DETAILS');
   shifts.push({time,value:number(details.value,0,1e6,'INVALID_SHIFT_VALUE'),recent:boolean(details.hadRecentInput,'INVALID_RECENT_INPUT')});
  }
 }
 lcp.sort((a,b)=>a.time-b.time);shifts.sort((a,b)=>a.time-b.time);
 let first=0,last=0,total=0,maximum=0,sessions=0,included=0;
 for(const shift of shifts){
  if(shift.recent)continue;
  if(!included||shift.time-last>=1000||shift.time-first>=5000){first=shift.time;total=shift.value;sessions++;}
  else total+=shift.value;
  included++;last=shift.time;maximum=Math.max(maximum,total);
 }
 if(!support.lcp)unknown.push('LCP_UNSUPPORTED');
 if(!support.cls)unknown.push('CLS_UNSUPPORTED');
 if(sampleEligible&&support.lcp&&!lcp.length)unknown.push(unavailableLcpTimes?'LCP_TIME_UNAVAILABLE':'NO_LCP_CANDIDATE');
 const excluded=ineligible.length>0,blocked=excluded||!sampleEligible;
 return {
  schemaVersion:1,measurement:'bounded-main-document-lab-snapshot',
  status:excluded?'INELIGIBLE':unknown.length?'UNKNOWN':'OBSERVED',reasons:[...ineligible,...unknown],
  navigationType:sample.navigationType,sampledAtMs:end,timePrecisionMs:0.01,
  visibility:{initial,current:sample.currentVisibility,historyAvailable:support.visibility&&initial!=='unknown'},support,
  lcp:{status:excluded?'EXCLUDED':blocked?'UNKNOWN':!support.lcp?'UNSUPPORTED':lcp.length?'CANDIDATE':'NO_CANDIDATE',
   candidateMs:!blocked&&support.lcp&&lcp.length?lcp.at(-1).value:null,candidateCount:lcp.length},
  cls:{status:excluded?'EXCLUDED':blocked?'UNKNOWN':!support.cls?'UNSUPPORTED':'WINDOW_SCORE',
   maxSessionScore:!blocked&&support.cls?Number(maximum.toPrecision(12)):null,
   reportedShifts:shifts.length,includedShifts:included,excludedRecentInput:shifts.length-included,sessionCount:sessions},
  coverage:{frameScope:'selected-main-document',allFrames:false,captureComplete:complete,ignoredFrameEvents:ignoredFrames,outsideWindowEvents:outsideWindow},
  limitations:['Bounded observation, not final lifetime metrics.','No subframe layout-shift aggregation.','Not a field population, CrUX result, or percentile assessment.','Hard navigations only; SPA route changes are not separate visits.']
 };
}
