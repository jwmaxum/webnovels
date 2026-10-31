import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePerformanceSample,PERFORMANCE_SAMPLE_LIMITS} from './lib/ui-performance-summary.mjs';
const origin=1700000000000,seconds=ms=>(origin+ms)/1000,main='MAIN_FRAME_PRIVATE';
const paint=(ms,extra={})=>({frameId:main,type:'largest-contentful-paint',time:seconds(ms),lcpDetails:{renderTime:seconds(ms),loadTime:0,size:5000,...extra}});
const shift=(ms,value,recent=false)=>({frameId:main,type:'layout-shift',time:seconds(ms),layoutShiftDetails:{value,hadRecentInput:recent}});
const sample=(overrides={})=>({timeOriginEpochMs:origin,sampledAtMs:10000,navigationType:'reload',activationStartMs:0,currentVisibility:'visible',supportedEntryTypes:['largest-contentful-paint','layout-shift','visibility-state'],visibilityEntries:[{name:'visible',startTime:0}],events:[paint(1250)],truncated:false,hasMore:false,...overrides});
const summarize=input=>summarizePerformanceSample(input,{mainFrameId:main});

test('normalizes CDP Epoch seconds to relative milliseconds without a navigation timing proxy',()=>{
 const result=summarize(sample({events:[paint(100.13),paint(1250.57)]}));
 assert.equal(result.status,'OBSERVED');assert.equal(result.lcp.candidateMs,1250.57);assert.equal(result.lcp.status,'CANDIDATE');assert.equal(result.cls.maxSessionScore,0);
 assert.match(result.measurement,/bounded/);assert.equal(result.coverage.allFrames,false);
});
test('LCP uses its last entry and load time only when render time is unavailable',()=>{
 const result=summarize(sample({events:[paint(1500),{...paint(2000),lcpDetails:{renderTime:0,loadTime:seconds(1750)}}]}));assert.equal(result.lcp.candidateMs,1750);
});
test('CLS is maximum session score, excludes recent input, and accepts unsorted event input',()=>{
 const result=summarize(sample({events:[paint(2000),shift(6000,.4),shift(500,.1),shift(1000,.2),shift(1500,10,true),shift(3000,.2)]}));
 assert.equal(result.cls.maxSessionScore,.4);assert.equal(result.cls.includedShifts,4);assert.equal(result.cls.excludedRecentInput,1);assert.equal(result.cls.sessionCount,3);
});
test('exact one-second gaps and five-second lifetime boundaries start new sessions',()=>{
 const gap=summarize(sample({events:[paint(2000),shift(100,.2),shift(1100,.3)]}));assert.equal(gap.cls.maxSessionScore,.3);assert.equal(gap.cls.sessionCount,2);
 const events=[0,900,1800,2700,3600,4500,5000].map(ms=>shift(ms,.1));
 const duration=summarize(sample({events:[paint(2000),...events]}));assert.equal(duration.cls.maxSessionScore,.6);assert.equal(duration.cls.sessionCount,2);
});
test('recent-input entries do not extend a CLS session',()=>{
 const result=summarize(sample({events:[paint(1500),shift(100,.2),shift(900,10,true),shift(1300,.3)]}));assert.equal(result.cls.maxSessionScore,.3);assert.equal(result.cls.sessionCount,2);
});
test('selects main-frame entries before projection and discards attribution, URLs and identifiers',()=>{
 const other={frameId:'CHILD_FRAME_PRIVATE',type:'not-observed',time:'not-a-time',url:'PRIVATE_URL'};
 const event=paint(500,{url:'https://private.invalid/?token=PRIVATE_SECRET',elementId:'PRIVATE_ELEMENT',nodeId:909});
 const layout=shift(600,.1);layout.layoutShiftDetails.sources=[{nodeId:'PRIVATE_NODE',previousRect:[1,2,3,4]}];
 const result=summarize(sample({events:[other,event,layout],unknown:'PRIVATE_FIELD'}));const encoded=JSON.stringify(result);
 assert.equal(result.coverage.ignoredFrameEvents,1);for(const sentinel of [main,'CHILD_FRAME_PRIVATE','PRIVATE_SECRET','PRIVATE_ELEMENT','PRIVATE_NODE','PRIVATE_URL','PRIVATE_FIELD'])assert(!encoded.includes(sentinel),sentinel);
});
test('buffered previous-document and later events cannot affect the bounded current snapshot',()=>{
 const result=summarize(sample({events:[paint(-1000),paint(2500),paint(11000),shift(-20,.8),shift(12000,.9)]}));assert.equal(result.lcp.candidateMs,2500);assert.equal(result.cls.maxSessionScore,0);assert.equal(result.coverage.outsideWindowEvents,4);
});
test('protocol-permitted non-frame targets are ignored without reading their details',()=>{
 const result=summarize(sample({events:[{frameId:'',type:'unrelated',time:'ignored'},paint(1000)]}));assert.equal(result.status,'OBSERVED');assert.equal(result.coverage.ignoredFrameEvents,1);assert.equal(result.lcp.candidateMs,1000);
});
test('initially hidden or backgrounded samples are ineligible even when currently visible',()=>{
 for(const history of [[{name:'hidden',startTime:0},{name:'visible',startTime:400}],[{name:'visible',startTime:0},{name:'hidden',startTime:5000},{name:'visible',startTime:6000}]]){
  const result=summarize(sample({visibilityEntries:history}));assert.equal(result.status,'INELIGIBLE');assert.equal(result.lcp.candidateMs,null);assert.equal(result.cls.maxSessionScore,null);
 }
});
test('a missing initial visibility history is unknown rather than a valid zero-CLS result',()=>{
 for(const overrides of [{visibilityEntries:[]},{supportedEntryTypes:['largest-contentful-paint','layout-shift']},{visibilityEntries:[{name:'visible',startTime:0},{name:'hidden',startTime:0}]}]){
  const result=summarize(sample(overrides));assert.equal(result.status,'UNKNOWN');assert.equal(result.cls.maxSessionScore,null);assert.equal(result.lcp.candidateMs,null);
 }
});
test('currently hidden, bfcache and prerender observations are excluded from controlled reloads',()=>{
 for(const overrides of [{currentVisibility:'hidden'},{navigationType:'back_forward'},{activationStartMs:10}]){const result=summarize(sample(overrides));assert.equal(result.status,'INELIGIBLE');assert.equal(result.cls.maxSessionScore,null);}
});
test('truncated or unconsumed buffers never become successful metrics',()=>{
 for(const overrides of [{truncated:true},{hasMore:true}]){const result=summarize(sample(overrides));assert.equal(result.status,'UNKNOWN');assert.equal(result.coverage.captureComplete,false);assert.equal(result.cls.maxSessionScore,null);}
});
test('capture flags must remain explicit booleans even when another flag already excludes the sample',()=>{
 for(const overrides of [{truncated:true,hasMore:'false'},{truncated:undefined},{hasMore:null}])assert.throws(()=>summarize(sample(overrides)),/INVALID_CAPTURE_STATE/);
});
test('unsupported paint/shift APIs and absent candidates stay distinct from a zero score',()=>{
 const unsupported=summarize(sample({supportedEntryTypes:['visibility-state']}));assert.equal(unsupported.status,'UNKNOWN');assert.equal(unsupported.lcp.candidateMs,null);assert.equal(unsupported.cls.maxSessionScore,null);
 const absent=summarize(sample({events:[]}));assert.equal(absent.status,'UNKNOWN');assert.equal(absent.lcp.status,'NO_CANDIDATE');assert.equal(absent.cls.maxSessionScore,0);
 const unavailable=summarize(sample({events:[paint(100,{renderTime:0,loadTime:0})]}));assert.equal(unavailable.lcp.candidateMs,null);assert(unavailable.reasons.includes('LCP_TIME_UNAVAILABLE'));
});
test('rejects milliseconds masquerading as Epoch seconds and nonfinite/nonnumeric timing',()=>{
 for(const event of [{...paint(10),time:origin+10},{...paint(10),time:10},{...paint(10),time:Infinity},paint(10,{renderTime:origin+10}),paint(10,{renderTime:'1000'})])assert.throws(()=>summarize(sample({events:[event]})),/UI_PERFORMANCE_INVALID_EPOCH_SECONDS/);
});
test('rejects malformed metric values and booleans without exposing supplied data',()=>{
 for(const event of [shift(10,-1),shift(10,NaN),shift(10,Infinity),shift(10,'PRIVATE_VALUE'),shift(10,.1,'true')]){
  assert.throws(()=>summarize(sample({events:[event]})),error=>/^UI_PERFORMANCE_INVALID_/.test(error.message)&&!error.message.includes('PRIVATE_VALUE'));
 }
});
test('bounds capture size, durations, history and frame selection',()=>{
 assert.throws(()=>summarize(sample({events:Array(PERFORMANCE_SAMPLE_LIMITS.events+1).fill(paint(10))})),/EVENT_LIMIT/);
 for(const sampledAtMs of [0,60001,NaN,'10000'])assert.throws(()=>summarize(sample({sampledAtMs})),/INVALID_SAMPLE_DURATION_MS/);
 assert.throws(()=>summarize(sample({visibilityEntries:Array(129).fill({name:'visible',startTime:0})})),/INVALID_VISIBILITY_HISTORY/);
 assert.throws(()=>summarizePerformanceSample(sample()),/INVALID_FRAME_SELECTION/);
 assert.throws(()=>summarize(sample({visibilityEntries:[{name:'visible',startTime:0},{name:'hidden',startTime:11000}]})),/INVALID_VISIBILITY_TIME_MS/);
});
