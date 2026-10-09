import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(new URL('../public/js/reader/growth-studio.js',import.meta.url)),source=await readFile(filename,'utf8');
class Element{constructor(tag='section'){this.tagName=tag;this.children=[];this.isConnected=true;this._text='';this.value='';}
 append(...n){this.children.push(...n);}replaceChildren(...n){this.children=[];this._text='';this.append(...n);}setAttribute(k,v){this[k]=v;}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set innerHTML(_){throw Error('HTML insertion forbidden');}all(tag){return this.children.flatMap(x=>[...(x.tagName===tag?[x]:[]),...x.all(tag)]);}}
const receipt='ffffffff-ffff-4fff-8fff-ffffffffffff',work={id:'35',title:'<img> 작품',author:'작가',receiptId:receipt};
const preferences={excludedGenres:[],frequency:'OFF',analyticsConsent:true,measurementConsent:true,measurementSince:'2026-10-09T01:00:00Z'};
const tick=()=>new Promise(r=>setImmediate(r));
function setup(handler){let who={userId:'reader-a',reader:{status:'ACTIVE'}},now=0,next=0;const root=new Element(),calls=[],timers=new Map(),observers=[],listeners=new Set();
 const document={hidden:false,createElement:t=>new Element(t),getElementById:()=>root,addEventListener:(name,f)=>listeners.add(f),removeEventListener:(name,f)=>listeners.delete(f)};
 class Observer{constructor(callback,options){this.callback=callback;this.options=options;this.nodes=new Set();observers.push(this);}observe(n){this.nodes.add(n);}unobserve(n){this.nodes.delete(n);}disconnect(){this.nodes.clear();this.disconnected=true;}}
 const c={document,console,URL,setTimeout:(f,ms)=>{timers.set(++next,{f,at:now+ms});return next;},clearTimeout:id=>timers.delete(id)};
 c.window={location:{href:'https://example.test/works/35?source=share',pathname:'/works/35'},IntersectionObserver:Observer,WEBNOVELS_CONFIG:{growthServiceEnabled:true,growthMeasurementEnabled:true},
  ReaderCatalog:{mapWork:w=>w},WebNovelsAuth:{getActor:()=>who,api:async(path,init)=>{const action=new URL(path,'https://example.test').searchParams.get('action'),body=init?JSON.parse(init.body):null;calls.push({action,body});
   if(handler)return handler(action,body);return action==='preferences'?preferences:action==='feed'?{works:[work],measurementConsent:true}:{};}}};
 vm.createContext(c);vm.runInContext(source,c,{filename});
 return {ui:c.window.GrowthStudio,window:c.window,root,calls,observers,timers,listeners,document,setActor:a=>{who=a;},
  enter:ratio=>{const o=observers.at(-1);o.callback([{target:root.all('a')[0],isIntersecting:ratio>0,intersectionRatio:ratio}]);},
  advance:ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.f();}},hidden:value=>{document.hidden=value;for(const f of listeners)f();}};
}
test('viewport requires 50 percent for one continuous second in visible tab, sends one receipt only',async()=>{
 const f=setup();await f.ui.home();assert.equal(f.observers[0].options.threshold[1],0.5);assert.equal(f.calls.filter(x=>x.action==='viewport').length,0);
 f.enter(0.49);f.advance(1100);assert.equal(f.timers.size,0);f.enter(0.5);f.advance(999);assert.equal(f.calls.filter(x=>x.action==='viewport').length,0);
 f.enter(0);f.advance(10);f.enter(0.5);f.hidden(true);f.advance(1100);assert.equal(f.calls.filter(x=>x.action==='viewport').length,0);
 f.hidden(false);f.advance(1000);await tick();const posts=f.calls.filter(x=>x.action==='viewport');assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{receiptId:receipt});
 f.enter(1);f.advance(1000);assert.equal(f.calls.filter(x=>x.action==='viewport').length,1);assert.equal(f.observers[0].nodes.size,0);
});
test('no observer without separate consent, flag, API support or server receipt',async()=>{
 for(const mode of ['consent','flag','support','receipt']){const f=setup(async action=>action==='preferences'?{...preferences,measurementConsent:mode!=='consent'}:
  action==='feed'?{works:[{...work,receiptId:mode==='receipt'?null:receipt}],measurementConsent:true}:{});
  if(mode==='flag')f.window.WEBNOVELS_CONFIG.growthMeasurementEnabled=false;if(mode==='support')delete f.window.IntersectionObserver;
  await f.ui.home();assert.equal(f.observers.length,0);assert.equal(f.calls.some(x=>x.action==='viewport'),false);}
});
test('route/reset/account changes cancel timers and late callbacks; failures do not loop retries',async()=>{
 for(const mode of ['route','reset','account']){const f=setup();await f.ui.home();f.enter(1);const observer=f.observers[0];
  if(mode==='route')f.ui.leaveHome();else if(mode==='reset')f.ui.reset();else f.setActor({userId:'reader-b',reader:{status:'ACTIVE'}});
  f.advance(1000);observer.callback([{target:f.root.all('a')[0],isIntersecting:true,intersectionRatio:1}]);f.advance(1000);
  assert.equal(f.calls.some(x=>x.action==='viewport'),false);if(mode!=='account'){assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);}}
 const failed=setup(async action=>action==='viewport'?Promise.reject(Error('offline')):action==='preferences'?preferences:{works:[work],measurementConsent:true});
 await failed.ui.home();failed.enter(1);failed.advance(1000);await tick();failed.advance(2000);assert.equal(failed.calls.filter(x=>x.action==='viewport').length,1);
});
test('additional checkbox never inherits existing analysis consent and withdrawal explicitly sends false',async()=>{
 const f=setup(async action=>action==='preferences'?{...preferences,measurementConsent:false}:action==='feed'?{works:[]}:{});await f.ui.home();
 const form=f.root.all('form')[0],inputs=form.all('input');assert.equal(inputs[2].checked,false);assert.match(form.textContent,/추가 선택/);inputs[2].checked=true;
 await form.onsubmit({preventDefault(){}});assert.equal(f.calls.find(x=>x.action==='save-preferences').body.measurementConsent,true);await tick();
 const next=f.root.all('form')[0];next.all('input')[1].checked=false;next.all('input')[2].checked=true;await next.onsubmit({preventDefault(){}});
 assert.equal(f.calls.filter(x=>x.action==='save-preferences').at(-1).body.measurementConsent,false);
});
test('share records enum only after consent; anonymous/unmarked/late account and route replies are discarded',async()=>{
 const f=setup();await f.ui.referral('35');await f.ui.referral('35');assert.deepEqual(f.calls.find(x=>x.action==='referral').body,{workId:'35',source:'SHARE'});assert.equal(f.calls.filter(x=>x.action==='referral').length,1);
 for(const mode of ['anonymous','unmarked','nonconsent','duplicate']){const x=setup(async()=>({...preferences,measurementConsent:mode!=='nonconsent'}));
  if(mode==='anonymous')x.setActor(null);if(mode==='unmarked')x.window.location.href='https://example.test/works/35';if(mode==='duplicate')x.window.location.href='https://example.test/works/35?source=share&source=share';
  await x.ui.referral('35');assert.equal(x.calls.some(v=>v.action==='referral'),false);}
 for(const mode of ['account','route','reset']){let resolve;const slow=setup(()=>new Promise(r=>{resolve=r;}));const p=slow.ui.referral('35');
  if(mode==='account')slow.setActor({userId:'reader-b',reader:{status:'ACTIVE'}});if(mode==='route')slow.window.location.pathname='/read/35/1';if(mode==='reset')slow.ui.reset();resolve(preferences);await p;assert.equal(slow.calls.some(v=>v.action==='referral'),false);}
 let attempts=0;const retry=setup(action=>action==='preferences'?(++attempts===1?Promise.reject(Error('offline')):preferences):{});await retry.ui.referral('35');await retry.ui.referral('35');assert.equal(retry.calls.some(x=>x.action==='referral'),true);
 let consent=false,epoch=preferences.measurementSince;const changed=setup(action=>action==='preferences'?{...preferences,measurementConsent:consent,measurementSince:epoch}:{});
 await changed.ui.referral('35');consent=true;await changed.ui.referral('35');assert.equal(changed.calls.filter(x=>x.action==='referral').length,1);
 consent=false;await changed.ui.referral('35');consent=true;epoch='2026-10-10T01:00:00Z';await changed.ui.referral('35');assert.equal(changed.calls.filter(x=>x.action==='referral').length,2);
});
test('creator funnel labels server issue and client reports as proxies with maturity/suppression',async()=>{
 const f=setup(async action=>action==='admin'?{viewportEvidenceScope:{maxExperiments:30,periodDays:28},viewportEvidence:[{version:'v1',variant:'CONTROL',status:'READY',firstBodyPairs:3,readerWorkPairs:6}]}:
  {funnel:{firstBodies:6,firstBodyStatus:'READY',channels:{VIEWPORT:{status:'READY',converted:3,denominator:6,rate:0.5},SHARE:{status:'PENDING',denominator:null}}}});
 f.setActor({userId:'author',author:{status:'APPROVED'}});f.ui.creator(f.root,[work]);await f.root.all('button')[0].onclick();
 assert.match(f.root.textContent,/첫 서버 본문 제공: 6/);assert.match(f.root.textContent,/3\/6 \(50.0%\)/);assert.match(f.root.textContent,/관찰 기간 대기/);assert.match(f.root.textContent,/수신 완료·생애 최초 독서·완독을 증명하지 않습니다/);
 f.setActor({userId:'admin',admin:{role:'SUPER_ADMIN'}});f.root.replaceChildren();f.ui.admin(f.root);await f.root.all('button')[0].onclick();
 assert.match(f.root.textContent,/v1 · CONTROL 화면 노출 신고/);assert.match(f.root.textContent,/3 \/ 6/);
 assert.match(f.root.textContent,/가장 최근 30개 실험/);
});
