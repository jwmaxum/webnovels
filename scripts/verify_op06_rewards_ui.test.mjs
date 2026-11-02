import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const readerCode=read('public/js/reader/reader-rewards-test.js'),adminCode=read('public/js/admin/admin-rewards-test.js'),css=read('public/css/rewards-test.css');
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',policyId='20000000-0000-4000-8000-000000000001',sessionId='30000000-0000-4000-8000-000000000001',grantId='40000000-0000-4000-8000-000000000001';
const clone=v=>JSON.parse(JSON.stringify(v)),base=Date.now(),time=minutes=>new Date(base+minutes*60000).toISOString(),stamp={mode:'TEST',provenance:'LOCAL_SIMULATED',provider:'NONE'};
const policy=(patch={})=>({id:policyId,adEnabled:false,campaignEnabled:false,rewardHours:24,sessionMinutes:5,graceMinutes:10,dailyLimit:20,campaignTitle:'',campaignStartsAt:null,campaignEndsAt:null,...patch});
const fallback={kind:'POINTS',chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100};
const session=(patch={})=>({id:sessionId,episodeId:'3',kind:'AD_REWARD',status:'WAITING_EVIDENCE',createdAt:time(0),expiresAt:time(5),acceptUntil:time(15),closedAt:null,rewardHours:24,policyVersion:policyId,grant:null,...patch});
const granted=(patch={})=>session({status:'GRANTED',grant:{id:grantId,kind:'AD_REWARD',expiresAt:time(1440)},...patch});
const page=(items=[],offset=0,total=items.length)=>({...stamp,items,offset,limit:50,total,hasMore:total>offset+50,nextOffset:total>offset+50?offset+50:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this._text='';this.value='';this.checked=false;this.disabled=false;this.isConnected=true;}
 set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+' '+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){assert.fail('reward UI must use native text nodes');}
 append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}
 querySelectorAll(selector){const tags=selector.split(',').map(s=>s.trim());return this.children.flatMap(n=>[...(tags.includes(n.tag)?[n]:[]),...n.querySelectorAll(selector)]);}
}
const all=root=>[root,...root.children.flatMap(all)],button=(root,label)=>all(root).find(n=>n.tag==='button'&&n._text===label);
const field=(root,label)=>all(root).find(n=>n.tag==='label'&&n.children[0]?._text===label)?.children.find(n=>['input','select'].includes(n.tag));
const form=root=>all(root).find(n=>n.tag==='form'&&n.getAttribute('aria-label')==='광고 보상 TEST 정책');
const enter=(n,v)=>{assert(n);n.value=v;return n.oninput?.()??n.onchange?.();};
const submit=root=>{assert(form(root));return form(root).onsubmit({preventDefault(){}});};
const toggle=(root,label,checked=true)=>{const n=all(root).find(n=>n.tag==='label'&&n.children.some(c=>c._text===label))?.children.find(n=>n.tag==='input');assert(n,label);n.checked=checked;n.onchange();};
function setup(kind='reader',{enabled=true,provider='NONE',adAvailable=provider==='INTERNAL_TEST',campaignAvailable=false,availability=adAvailable?'INTERNAL_TEST':'UNAVAILABLE',handler,role='SUPER_ADMIN',readerStatus='ACTIVE',episodeId='3',onGranted}={}){
 let actor={userId:user,reader:{status:readerStatus},admin:{is_active:true,role}},current=true,serial=0,currentEpisode=episodeId;
 const root=new Element(),calls=[],notified=[],marker={...stamp,provider},server={revision:'0',policy:policy({adEnabled:adAvailable,campaignEnabled:campaignAvailable,campaignTitle:campaignAvailable?'명시 무료 캠페인':'',campaignStartsAt:campaignAvailable?time(-60):null,campaignEndsAt:campaignAvailable?time(60):null}),session:null};
 const options=()=>({...marker,episodeId:currentEpisode,access:'LOCKED',availability,adAvailable,campaignAvailable,policy:clone(server.policy),fallback:clone(fallback)});
 const state=()=>({...marker,revision:server.revision,policy:clone(server.policy),providerReady:provider==='INTERNAL_TEST'});
 const c={URL,URLSearchParams,Date,BigInt,Object,crypto:{randomUUID:()=>`50000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},WEBNOVELS_CONFIG:{adRewardsTestEnabled:enabled},document:{createElement:t=>new Element(t)},WebNovelsAuth:{getActor:()=>actor,api:async(url,init={})=>{
  const u=new URL(url,'https://app.test'),action=u.searchParams.get('action'),data=init.body?JSON.parse(init.body):Object.fromEntries([...u.searchParams].filter(([k])=>k!=='action'));calls.push({url,action,data,init});
  if(handler){const value=await handler(action,data,{calls,server,marker,options,state});if(value!==undefined)return value;}
  if(action==='options')return options();if(action==='state')return state();if(action==='sessions')return {...page([],Number(data.offset)),...marker};
  if(action==='policy'){server.revision=String(BigInt(server.revision)+1n);server.policy={id:policyId,...data};return {...state(),saved:true,replayed:false};}
  if(action==='start'){if(data.kind==='CAMPAIGN_FREE')server.session=granted({episodeId:data.episodeId,kind:'CAMPAIGN_FREE',grant:{id:grantId,kind:'CAMPAIGN_FREE',expiresAt:time(1440)}});else server.session=session({episodeId:data.episodeId});return {...marker,session:clone(server.session),replayed:false,challenge:{protocol:'OP06_INTERNAL_TEST_V1',sessionId,nonce:'PRIVATE_NONCE_MUST_NOT_DISPLAY',channelId:'PRIVATE_CHANNEL',policyVersion:policyId}};}
  if(action==='status')return {...marker,session:clone(server.session??session())};
  if(action==='close'){server.session=session({status:'CLOSED_PENDING',closedAt:time(1)});return {...marker,session:clone(server.session),replayed:false};}
  assert.fail('unexpected action '+action);
 }}};c.window=c;vm.createContext(c);vm.runInContext(kind==='reader'?readerCode:adminCode,c);
 const module=kind==='reader'?c.ReaderRewardsTest:c.AdminRewardsTest;
 return {root,c,calls,server,module,notified,render:(nextEpisode=episodeId)=>{currentEpisode=nextEpisode;return module.render(root,{episodeId:nextEpisode,isCurrent:()=>current,onGranted:value=>{notified.push(clone(value));return onGranted?.(value);}});},away:()=>current=false,setActor:v=>actor=v};
}
const consent=app=>toggle(app.root,'실제 광고가 아닌 내부 TEST이며 완료 증빙 시각부터 24시간 유효한 회차 열람권 조건에 동의합니다.');
const start=app=>button(app.root,'서버 검증 TEST 세션 시작').onclick();
const reason=app=>enter(field(app.root,'보상 정책 변경 사유 (3~500자)'),'내부 검증 보상 조건 변경');

test('OFF or wrong roles issue no reward requests and never fabricate access',async()=>{
 for(const kind of ['reader','admin']){const app=setup(kind,{enabled:false});await app.render();assert.equal(app.calls.length,0);assert.match(app.root.textContent,/준비/);assert.equal(app.notified.length,0);}
 const reader=setup('reader',{readerStatus:'BLOCKED'});await reader.render();assert.equal(reader.calls.length,0);assert.match(reader.root.textContent,/활성 독자/);
 const admin=setup('admin',{role:'SUB_ADMIN'});await admin.render();assert.equal(admin.calls.length,0);assert.match(admin.root.textContent,/최고 관리자/);
});
test('no advertising defaults to explicit point purchase with 10000KRW/10000P and no free claim',async()=>{
 const app=setup();await app.render();assert.match(app.root.textContent,/10,000원 → 10,000P/);assert.match(app.root.textContent,/광고가 없습니다/);const link=all(app.root).find(n=>n.tag==='a');assert.equal(link.href,'/charging-test');assert(!button(app.root,'서버 검증 TEST 세션 시작'));assert(!button(app.root,'무료 캠페인 조건 확인 후 신청'));assert.deepEqual(app.calls.map(v=>v.action),['options']);assert.equal(app.notified.length,0);
 const lost=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start')return {...stamp,availability:'UNAVAILABLE',session:null,fallback,replayed:false};}});await lost.render();consent(lost);await start(lost);assert.match(lost.root.textContent,/포인트 충전을 기본/);assert(!button(lost.root,'서버 검증 TEST 세션 시작'));assert.equal(lost.notified.length,0);
});
test('internal TEST reads options without starting playback, proof, order or grant',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();assert.match(app.root.textContent,/실제 광고 영상이 없습니다/);assert.equal(button(app.root,'서버 검증 TEST 세션 시작').disabled,true);assert.deepEqual(app.calls.map(v=>v.action),['options']);consent(app);assert.equal(button(app.root,'서버 검증 TEST 세션 시작').disabled,false);assert.equal(app.calls.length,1);
});
test('explicit internal start sends only displayed policy version, episode, kind, consent and stable requestId',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();consent(app);await start(app);const call=app.calls.find(v=>v.action==='start');assert.deepEqual(Object.keys(call.data).sort(),['consent','episodeId','kind','policyVersion','requestId']);assert.equal(call.data.episodeId,'3');assert.equal(call.data.kind,'AD_REWARD');assert.equal(call.data.policyVersion,policyId);assert.equal(call.data.consent,true);assert.equal(call.init.method,'POST');assert.match(app.root.textContent,/서버 증빙 확인 대기/);assert.doesNotMatch(app.root.textContent,/PRIVATE_NONCE|PRIVATE_CHANNEL/);assert.equal(app.notified.length,0);assert.equal(button(app.root,'서버 검증 TEST 세션 시작').disabled,true);
});
test('server-confirmed grant invokes parent once without consuming points or making a purchase',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();consent(app);await start(app);app.server.session=granted();await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,1);assert.equal(app.notified[0].episodeId,'3');assert.equal(app.notified[0].grant.id,grantId);await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,1);assert.match(app.root.textContent,/임시 열람권 유효/);assert(!app.calls.some(v=>['purchase','credit','create','callback','verify'].includes(v.action)));
});
test('browser close preserves waiting and late validated completion may still grant',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();consent(app);await start(app);await button(app.root,'이 TEST 참여 중단').onclick();const close=app.calls.find(v=>v.action==='close');assert.deepEqual(Object.keys(close.data).sort(),['requestId','sessionId']);assert.match(app.root.textContent,/참여 중단 · 이전 완료 증빙 확인 대기/);assert.equal(app.notified.length,0);app.server.session=granted({closedAt:time(1)});await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,1);
});
test('no-fill, rejection and expiration keep point purchase available and never notify granted',async()=>{
 for(const status of ['NO_FILL','REJECTED','EXPIRED']){const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();consent(app);await start(app);app.server.session=session({status});await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,0);assert(all(app.root).some(n=>n.tag==='a'&&n.href==='/charging-test'));assert(!all(app.root).some(n=>n._text==='서버 확인 · 열람권 발급'));}
});
test('campaign is a separately labelled explicit claim that does not require advertising readiness',async()=>{
 const app=setup('reader',{campaignAvailable:true});await app.render();assert.equal(app.calls.length,1);assert(!button(app.root,'서버 검증 TEST 세션 시작'));assert.match(app.root.textContent,/운영자 무료 캠페인 · 광고와 별도/);await button(app.root,'무료 캠페인 조건 확인 후 신청').onclick();const call=app.calls.find(v=>v.action==='start');assert.equal(call.data.kind,'CAMPAIGN_FREE');assert.equal(call.data.policyVersion,policyId);assert.equal(call.data.consent,true);assert.equal(app.notified.length,1);assert.equal(app.notified[0].grant.kind,'CAMPAIGN_FREE');
});
test('unknown start reuses exact payload through leave and never creates duplicate requests while pending',async()=>{
 let attempts=0;const hold=deferred(),app=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start'&&++attempts===1)return hold.promise;}});await app.render();consent(app);const posting=start(app);await start(app);assert.equal(app.calls.filter(v=>v.action==='start').length,1);hold.reject(TypeError('network'));await posting;const original=app.calls.find(v=>v.action==='start').init.body;assert(button(app.root,'같은 보상 요청으로 결과 확인'));app.module.leave();await app.render();await button(app.root,'같은 보상 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(v=>v.action==='start')[1].init.body,original);
});
test('known denial clears stale retry rather than silently issuing another start',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start')throw Object.assign(Error('limit'),{status:429,code:'RATE_LIMITED'});}});await app.render();consent(app);await start(app);assert.equal(app.calls.filter(v=>v.action==='start').length,1);assert(!button(app.root,'같은 보상 요청으로 결과 확인'));assert.match(app.root.textContent,/한도/);assert.equal(app.notified.length,0);
 const existing=setup('reader',{provider:'INTERNAL_TEST',campaignAvailable:true,handler(action,data){if(action==='start'&&data.kind==='CAMPAIGN_FREE')throw Object.assign(Error('pending'),{status:409,code:'REWARD_SESSION_PENDING'});}});await existing.render();consent(existing);await start(existing);await button(existing.root,'무료 캠페인 조건 확인 후 신청').onclick();assert.match(existing.root.textContent,/이전 조건의 세션 확인을 기다리고/);assert(button(existing.root,'서버 보상 결과 확인'));assert(existing.root.textContent.includes(sessionId));assert(all(existing.root).some(n=>n.tag==='a'&&n.href==='/charging-test'));assert.equal(existing.calls.filter(v=>v.action==='start').length,2);assert.equal(existing.notified.length,0);
});

test('policy change discards prior consent and requires fresh conditions without automatic restart',async()=>{
 let attempts=0;const nextPolicy='20000000-0000-4000-8000-000000000002',app=setup('reader',{provider:'INTERNAL_TEST',handler(action,data,{server}){if(action==='start'&&++attempts===1){server.policy=policy({id:nextPolicy,adEnabled:true,rewardHours:48});throw Object.assign(Error('changed'),{status:409,code:'REWARD_POLICY_CHANGED'});}}});await app.render();consent(app);await start(app);assert.equal(app.calls.find(v=>v.action==='start').data.policyVersion,policyId);assert.match(app.root.textContent,/최신 조건을 다시 불러오고/);assert(!button(app.root,'서버 검증 TEST 세션 시작'));assert(!button(app.root,'같은 보상 요청으로 결과 확인'));await button(app.root,'광고 조건·현재 상태 새로고침').onclick();assert.equal(app.calls.filter(v=>v.action==='start').length,1);assert.match(app.root.textContent,/48시간/);assert.equal(button(app.root,'서버 검증 TEST 세션 시작').disabled,true);toggle(app.root,'실제 광고가 아닌 내부 TEST이며 완료 증빙 시각부터 48시간 유효한 회차 열람권 조건에 동의합니다.');await start(app);assert.equal(app.calls.filter(v=>v.action==='start')[1].data.policyVersion,nextPolicy);
});
test('account changes discard every private episode pending state',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start')throw TypeError('network');}});await app.render();consent(app);await start(app);assert(button(app.root,'같은 보상 요청으로 결과 확인'));app.setActor({userId:other,reader:{status:'ACTIVE'}});await app.render();assert(!button(app.root,'같은 보상 요청으로 결과 확인'));app.module.reset();assert.equal(app.root.textContent.trim(),'');
});

test('unknown request survives a different episode and returns with its exact original ID',async()=>{
 let attempts=0;const app=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start'&&++attempts===1)throw TypeError('network');}});await app.render();consent(app);await start(app);const original=app.calls.find(v=>v.action==='start').init.body;await app.render('9');assert(!button(app.root,'같은 보상 요청으로 결과 확인'));await app.render('3');assert(button(app.root,'같은 보상 요청으로 결과 확인'));await button(app.root,'같은 보상 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(v=>v.action==='start')[1].init.body,original);
});

test('participation TTL expiry still waits for the evidence grace window and keeps charging available',async()=>{
 const app=setup('reader',{provider:'INTERNAL_TEST'});await app.render();consent(app);await start(app);app.server.session=session({status:'EXPIRED',createdAt:time(-10),expiresAt:time(-1),acceptUntil:time(10)});await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(button(app.root,'서버 검증 TEST 세션 시작').disabled,true);assert(all(app.root).some(n=>n.tag==='a'&&n.href==='/charging-test'));app.server.session=granted({createdAt:time(-10),expiresAt:time(-1),acceptUntil:time(10)});await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,1);
});
test('late status or start responses never reach a departed host or grant callback',async()=>{
 for(const action of ['status','start']){const hold=deferred(),app=setup('reader',{provider:'INTERNAL_TEST',handler(name){if(name===action)return hold.promise;}});await app.render();consent(app);const posting=start(app);if(action==='status')await posting;const checking=action==='status'?button(app.root,'서버 보상 결과 확인').onclick():posting;app.module.leave();hold.resolve({...stamp,provider:'INTERNAL_TEST',session:granted()});await checking;assert.equal(app.root.textContent.trim(),'');assert.equal(app.notified.length,0);}
});
test('invalid DTOs and expired grants never create or extend a current right',async()=>{
 for(const patch of [{mode:'LIVE'},{session:granted({episodeId:'99'})},{session:granted({grant:{id:'bad',kind:'AD_REWARD',expiresAt:time(1440)}})}]){const app=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='status')return {...stamp,provider:'INTERNAL_TEST',session:granted(),...patch};}});await app.render();consent(app);await start(app);await button(app.root,'서버 보상 결과 확인').onclick();assert.equal(app.notified.length,0);}
 const expired=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='status')return {...stamp,provider:'INTERNAL_TEST',session:granted({grant:{id:grantId,kind:'AD_REWARD',expiresAt:time(-1)}})};}});await expired.render();consent(expired);await start(expired);await button(expired.root,'서버 보상 결과 확인').onclick();assert.equal(expired.notified.length,0);assert.match(expired.root.textContent,/기간 종료/);
});
test('already accessible options do not automatically start or invoke parent loops',async()=>{
 const app=setup('reader',{availability:'ALREADY_ACCESSIBLE'});await app.render();assert.equal(app.notified.length,0);assert(!button(app.root,'서버 검증 TEST 세션 시작'));await button(app.root,'현재 회차 상태 확인').onclick();assert.equal(app.notified.length,1);assert(!app.calls.some(v=>v.action==='start'));
 const race=setup('reader',{provider:'INTERNAL_TEST',handler(action){if(action==='start')return {...stamp,availability:'ALREADY_ACCESSIBLE',session:null,fallback,replayed:false};}});await race.render();consent(race);await start(race);assert.equal(race.notified.length,0);assert(!button(race.root,'서버 검증 TEST 세션 시작'));await button(race.root,'현재 회차 상태 확인').onclick();assert.equal(race.notified.length,1);
});
test('admin reads policy and paged sessions without granting or enabling real advertising',async()=>{
 const app=setup('admin');await app.render();assert.deepEqual(app.calls.map(v=>v.action),['state','sessions']);assert.match(app.root.textContent,/내부 TEST 수신 미준비/);assert.equal(field(app.root,'보상 유효 시간 (1~168시간)').value,'24');assert.match(app.root.textContent,/10,000원 → 10,000P/);assert.match(app.root.textContent,/설정 저장은 실제 광고 연결이나 수익 확정이 아닙니다/);
});
test('admin policy sends CAS, exact bounded fields and KST as UTC with explicit campaign consent',async()=>{
 const app=setup('admin');await app.render();reason(app);toggle(app.root,'운영자 무료 캠페인 별도 신청 허용');enter(field(app.root,'무료 캠페인 제목 (3~100자)'),'명시 회차 무료권');enter(field(app.root,'무료 캠페인 시작 (한국 시간 KST)'),'2026-11-03T09:30');enter(field(app.root,'무료 캠페인 종료 (한국 시간 KST)'),'2026-11-04T09:30');await submit(app.root);const call=app.calls.find(v=>v.action==='policy');assert.deepEqual(Object.keys(call.data).sort(),['adEnabled','campaignEnabled','campaignEndsAt','campaignStartsAt','campaignTitle','dailyLimit','graceMinutes','reason','requestId','revision','rewardHours','sessionMinutes']);assert.equal(call.data.campaignStartsAt,'2026-11-03T00:30:00.000Z');assert.equal(call.data.campaignEndsAt,'2026-11-04T00:30:00.000Z');assert.equal(call.data.campaignEnabled,true);assert.equal(call.data.revision,'0');assert.equal(call.init.method,'POST');assert.match(app.root.textContent,/기존 세션 조건은 유지/);
});
test('admin rejects invalid bounds and campaign periods before writing',async()=>{
 for(const [label,value]of [['보상 유효 시간 (1~168시간)','0'],['세션 참여 시간 (1~30분)','31'],['지연 증빙 유예 (0~60분)','-1'],['회원별 한국시간 일일 한도 (1~100회)','1.5'],['무료 캠페인 시작 (한국 시간 KST)','2026-02-30T10:00'],['무료 캠페인 시작 (한국 시간 KST)','2026-11-03T10:00'],['무료 캠페인 제목 (3~100자)','가'.repeat(101)]]){const app=setup('admin');await app.render();reason(app);enter(field(app.root,label),value);await submit(app.root);assert(!app.calls.some(v=>v.action==='policy'));}
 const missing=setup('admin');await missing.render();reason(missing);toggle(missing.root,'운영자 무료 캠페인 별도 신청 허용');await submit(missing.root);assert(!missing.calls.some(v=>v.action==='policy'));
});
test('CAS conflict preserves edits and requires explicit refresh before new save',async()=>{
 let attempt=0;const app=setup('admin',{handler(action){if(action==='policy'&&++attempt===1)throw Object.assign(Error('conflict'),{status:409,code:'REVISION_CONFLICT'});}});await app.render();reason(app);enter(field(app.root,'보상 유효 시간 (1~168시간)'),'48');await submit(app.root);assert.equal(field(app.root,'보상 유효 시간 (1~168시간)').value,'48');assert.equal(button(app.root,'TEST 보상 정책 버전 저장').disabled,true);await button(app.root,'최신 보상 정책·세션 불러오기').onclick();assert.equal(button(app.root,'TEST 보상 정책 버전 저장').disabled,false);assert.equal(field(app.root,'보상 유효 시간 (1~168시간)').value,'48');
});
test('unknown admin policy reuses original request after leaving',async()=>{
 let attempts=0;const app=setup('admin',{handler(action){if(action==='policy'&&++attempts===1)throw TypeError('network');}});await app.render();reason(app);await submit(app.root);const body=app.calls.find(v=>v.action==='policy').init.body;app.module.leave();await app.render();await button(app.root,'같은 보상 정책 요청으로 결과 확인').onclick();assert.equal(app.calls.filter(v=>v.action==='policy')[1].init.body,body);
});
test('admin filters and pages server sessions without carrying private proof data',async()=>{
 const app=setup('admin',{handler(action,data){if(action==='sessions')return {...page([session({userId:user,nonce:'PRIVATE_NONCE',binding:'PRIVATE_BINDING'})],Number(data.offset),51)};}});await app.render();assert.doesNotMatch(app.root.textContent,/PRIVATE_/);assert.match(app.root.textContent,new RegExp(user));await button(app.root,'다음 보상 세션').onclick();assert.equal(app.calls.filter(v=>v.action==='sessions').at(-1).data.offset,50);enter(field(app.root,'보상 상태'),'NO_FILL');await new Promise(done=>setImmediate(done));assert.equal(app.calls.filter(v=>v.action==='sessions').at(-1).data.status,'NO_FILL');assert.equal(app.calls.filter(v=>v.action==='sessions').at(-1).data.offset,0);assert(!app.calls.some(v=>v.action==='policy'));
});
test('admin late responses and malformed state cannot enable stale or foreign forms',async()=>{
 const hold=deferred(),app=setup('admin',{handler(action){if(action==='state')return hold.promise;}});const rendering=app.render();app.module.leave();hold.resolve({...stamp,revision:'0',policy:policy(),providerReady:false});await rendering;assert.equal(app.root.textContent.trim(),'');
 const broken=setup('admin',{handler(action){if(action==='state')return {...stamp,revision:'0',policy:policy({rewardHours:0}),providerReady:false};}});await broken.render();assert(!form(broken.root));assert(!broken.calls.some(v=>v.action==='sessions'));
});
test('hostile campaign names render as text and scoped controls preserve accessibility',async()=>{
 const app=setup('reader',{campaignAvailable:true,handler(action,data,{options}){if(action==='options')return {...options(),policy:policy({campaignEnabled:true,campaignTitle:'<img src=x onerror=alert(1)>',campaignStartsAt:time(-1),campaignEndsAt:time(1)})};}});await app.render();assert.match(app.root.textContent,/<img src=x onerror=alert\(1\)>/);assert(!all(app.root).some(n=>n.tag==='img'));assert(all(app.root).some(n=>n.getAttribute('role')==='status'&&n.getAttribute('aria-live')==='polite'));await transform(css,{loader:'css'});assert.match(css,/min-height: 44px/);assert.match(css,/:focus-visible/);assert.match(css,/@media \(max-width: 650px\)/);assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b/i);for(const source of [readerCode,adminCode])assert.doesNotMatch(source,/innerHTML|localStorage|sessionStorage|setInterval|setTimeout|TossPayments|\.src\s*=|console\.log|\.location\s*=/);
});
