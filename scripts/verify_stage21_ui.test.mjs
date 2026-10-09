import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(new URL('../public/js/reader/growth-studio.js',import.meta.url));
const source=await readFile(filename,'utf8');
class Element{
 constructor(tag='section'){this.tagName=tag;this.children=[];this.isConnected=true;this.value='';this.disabled=false;this._text='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 set innerHTML(_){throw Error('HTML insertion forbidden');}setAttribute(k,v){this[k]=v;}
 all(tag){return this.children.flatMap(x=>[...(x.tagName===tag?[x]:[]),...x.all(tag)]);}
}
const basePrefs={excludedGenres:['판타지'],frequency:'WEEKLY',analyticsConsent:false};
const work={id:'35',title:'<img onerror=x> 작품',author:'필명',reason:'RECENT_PUBLIC_SERIAL'};
const metrics={episodes:1,novelCharactersWithSpaces:12,webtoonAssets:0,reading:{status:'READY',uniqueReaders:5,readerEpisodePairs:6,completionProxy:0.75},favoritesCurrent:5,d7:{status:'PENDING',rate:null},d28:{status:'READY',rate:0.5,returned:3,denominator:6},providedCards:{denominator:5,subsequentReaders:2},serialSupply:{newEpisodes:1,replacedHeads:2,activeKstDays:1}};
function setup(handler=async(action)=>action==='preferences'?basePrefs:action==='feed'?{works:[work]}:{}){
 const root=new Element();root.id='growthHome';let who={userId:'reader-a',reader:{status:'ACTIVE'}};const calls=[];
 const c={document:{getElementById:id=>id==='growthHome'?root:null,createElement:tag=>new Element(tag)},fetch:async(path)=>{calls.push({path,public:true});return Response.json(await handler('feed'));},console};
 c.window={WEBNOVELS_CONFIG:{growthServiceEnabled:true},ReaderCatalog:{mapWork:w=>w},WebNovelsAuth:{getActor:()=>who,api:async(path,init)=>{const u=new URL(path,'https://example.test');calls.push({path,action:u.searchParams.get('action'),body:init?JSON.parse(init.body):null});return handler(u.searchParams.get('action'),init?JSON.parse(init.body):null);}}};
 vm.createContext(c);vm.runInContext(source,c,{filename});return {ui:c.window.GrowthStudio,root,calls,window:c.window,setActor:a=>{who=a;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('disabled growth makes no request or DOM changes; anonymous cards are inert text with public links',async()=>{
 const f=setup();f.window.WEBNOVELS_CONFIG.growthServiceEnabled=false;await f.ui.home();f.ui.creator(f.root,[]);f.ui.admin(f.root);assert.equal(f.calls.length,0);assert.equal(f.root.children.length,0);
 f.window.WEBNOVELS_CONFIG.growthServiceEnabled=true;f.setActor(null);await f.ui.home();assert.equal(f.calls.length,1);assert.equal(f.calls[0].public,true);
 assert.match(f.root.textContent,/<img onerror/);assert.equal(f.root.all('a')[0].href,'/works/35');assert.match(f.root.textContent,/최근 30일/);assert.equal(f.root.all('form').length,0);
});
test('outages have no legacy fallback; author retry reuses the same panel and pending requests do not duplicate',async()=>{
 const empty=setup(async()=>{throw Error('offline');});empty.setActor(null);await empty.ui.home();assert.match(empty.root.textContent,/다시 조회/);
 let n=0;const f=setup(async()=>{if(n++===0)throw Error('offline');return metrics;});f.setActor({userId:'author',author:{status:'APPROVED'}});f.ui.creator(f.root,[work]);await f.root.all('button')[0].onclick();
 const retry=f.root.all('button').find(x=>x.textContent==='다시 조회');await retry.onclick();assert.equal(f.root.children.length,1);assert.match(f.root.textContent,/75.0%/);
 const a=setup(async action=>{throw Object.assign(Error('invalid'),{code:action==='configure'?'INVALID_POLICY':action==='evaluate'?'WORK_NOT_ELIGIBLE_AT_CUTOFF':'INVALID_DECISION'});});a.setActor({userId:'admin',admin:{role:'SUPER_ADMIN'}});a.ui.admin(a.root);
 const [policy,evaluate,decision]=a.root.all('form');const fields=policy.all('input');fields[3].value='2026-10-09T00:00';fields[4].value='2026-11-09T00:00';
 await policy.onsubmit({preventDefault(){}});assert.match(policy.textContent,/최대 90일/);await evaluate.onsubmit({preventDefault(){}});assert.match(evaluate.textContent,/KST 0시/);
 await decision.onsubmit({preventDefault(){}});assert.match(decision.textContent,/10자 이상의 근거/);
});
test('preferences save and reset are explicit and preserve the server identity and consent',async()=>{
 const f=setup();await f.ui.home();const form=f.root.all('form')[0],inputs=form.all('input');assert.equal(inputs[0].value,'판타지');assert.equal(inputs[1].checked,false);
 inputs[0].value='로맨스, 무협';inputs[1].checked=true;await form.onsubmit({preventDefault(){}});await tick();
 const saved=f.calls.find(x=>x.action==='save-preferences');assert.deepEqual(saved.body,{excludedGenres:['로맨스','무협'],frequency:'WEEKLY',analyticsConsent:true});assert.equal(saved.body.userId,undefined);
 const reset=f.root.all('button').find(x=>x.textContent==='추천 초기화');await reset.onclick();await tick();assert.deepEqual(f.calls.find(x=>x.action==='reset').body,{});
 assert.match(f.root.textContent,/분석 동의·관심작·열람 위치는 유지/);
});
test('invalid preference count and server error keep controls usable with an alert',async()=>{
 const f=setup(async action=>action==='preferences'?basePrefs:action==='feed'?{works:[]}:Promise.reject(Error('offline')));await f.ui.home();const form=f.root.all('form')[0];
 form.all('input')[0].value=Array(9).fill('장르').join(',');await form.onsubmit({preventDefault(){}});assert.match(form.textContent,/최대 8개/);assert.ok(!f.calls.some(x=>x.action==='save-preferences'));
 form.all('input')[0].value='로맨스';await form.onsubmit({preventDefault(){}});assert.match(f.root.textContent,/다시 조회/);assert.equal(form.all('button')[0].disabled,false);
 await form.all('button')[1].onclick();assert.equal(form.all('button')[1].disabled,false);
});
test('account switch/reset/navigation invalidate late private replies and clear visible data',async()=>{
 let resolve;const f=setup(action=>action==='preferences'?new Promise(r=>{resolve=r;}):Promise.resolve({works:[work]}));const p=f.ui.home();
 f.setActor({userId:'reader-b',reader:{status:'ACTIVE'}});resolve(basePrefs);await p;assert.equal(f.calls.length,1);assert.equal(f.root.all('a').length,0);
 f.ui.reset();assert.equal(f.root.children.length,0);assert.equal(f.root.hidden,true);
 const q=f.ui.home();f.ui.leaveHome();resolve(basePrefs);await q;assert.equal(f.root.children.length,0);assert.equal(f.root.hidden,true);
});
test('author reports show maturity and denominators and ignore late cross-account results',async()=>{
 const f=setup(async action=>action==='report'?metrics:{});f.setActor({userId:'author-a',author:{status:'APPROVED'}});f.ui.creator(f.root,[work]);await f.root.all('button')[0].onclick();
 assert.match(f.root.textContent,/75.0%/);assert.match(f.root.textContent,/관찰 기간 대기/);assert.match(f.root.textContent,/50.0% \(3\/6\)/);assert.match(f.root.textContent,/이전 공개본 교체 2건/);
 assert.match(f.calls[0].path,/\/creator\/growth.*workId=35/);assert.ok(!f.root.textContent.includes('UNCLASSIFIED'));
 let resolve;const slow=setup(()=>new Promise(r=>{resolve=r;}));slow.ui.creator(slow.root,[work]);const p=slow.root.all('button')[0].onclick();slow.ui.reset();resolve(metrics);await p;assert.equal(slow.root.textContent,'');
});
test('SUPER_ADMIN can review and configure/decide/evaluate using bounded explicit forms',async()=>{
 const f=setup(async action=>action==='admin'?{works:[{...work,genre:['판타지'],metrics}],experiments:[{version:'v1',config:{hypothesis:'시험 가설'},decision:null}],evaluations:[{workId:'35',policyVersion:'v1',kstDay:'2026-10-09',decision:'INSUFFICIENT_SAMPLE'}],variantEvidence:[{version:'v1',variant:'CONTROL',status:'INSUFFICIENT',providedReaderWorkPairs:null,subsequentReadingPairs:null}]}:{});
 f.setActor({userId:'admin',admin:{role:'SUB_ADMIN'}});f.ui.admin(f.root);assert.equal(f.root.children.length,0);
 f.setActor({userId:'admin',admin:{role:'SUPER_ADMIN'}});f.ui.admin(f.root);await f.root.all('button')[0].onclick();assert.match(f.root.textContent,/실제 승격 없음/);
 const [policy,evaluate,decision]=f.root.all('form'),fields=policy.all('input');
 fields[0].value='v1';fields[1].value='가설 상세 내용 10자 이상';fields[2].value='대조 기준 설명 10자 이상';fields[3].value='2026-10-09T00:00';fields[4].value='2026-11-09T00:00';
 policy.all('select')[0].value='NOVEL';await policy.onsubmit({preventDefault(){}});await tick();assert.equal(f.calls.find(x=>x.action==='configure').body.config.startsAt,'2026-10-08T15:00:00.000Z');
 evaluate.all('input')[0].value='35';evaluate.all('input')[1].value='v1';await evaluate.onsubmit({preventDefault(){}});assert.deepEqual(f.calls.find(x=>x.action==='evaluate').body,{workId:'35',version:'v1'});
 const d=decision.all('input');d[0].value='v1';d[1].value='표본 부족으로 후속 관찰합니다.';for(let i=5;i<8;i++)d[i].value='실제 관찰과 분모 증거가 필요합니다.';decision.all('select')[0].value='CHANGE';await decision.onsubmit({preventDefault(){}});assert.equal(f.calls.find(x=>x.action==='decide').body.decision,'CHANGE');
});
