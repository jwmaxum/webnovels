import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {uid,other,pid,eid,marker,policy,summary,payee,author,admin,overview,state,payout,earning,page} from './fixtures/op07-api.mjs';
const code=readFileSync(new URL('../public/js/shared/payouts-test.js',import.meta.url),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this._text='';this.value='';this.isConnected=true;this.classList={add(){}};this.disabled=false;}
 set textContent(v){this.replaceChildren();this._text=String(v??'');}get textContent(){return this._text+' '+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){assert.fail('native text nodes required');}
 append(...nodes){for(const n of nodes){n.isConnected=this.isConnected;this.children.push(n);}}
 disconnect(){this.isConnected=false;this.children.forEach(n=>n.disconnect());}
 replaceChildren(...nodes){this.children.forEach(n=>n.disconnect());this.children=[];this._text='';this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
 querySelectorAll(s){return all(this).slice(1).filter(n=>s==='button[data-write]'?n.tag==='button'&&n.attrs['data-write']!==undefined:n.tag===s);}
}
const all=r=>[r,...r.children.flatMap(all)],button=(a,label)=>all(a.root).find(n=>n.tag==='button'&&n._text===label),field=(a,label)=>all(a.root).find(n=>n.tag==='label'&&n.children[0]?._text===label)?.children.find(n=>['input','select'].includes(n.tag));
function fixture({isAdmin=false,enabled=true,who=isAdmin?admin:author,handler}={}){
 const root=new Element(),calls=[],data={payout:payout(),overview:overview(),state:state(),earnings:[earning()],authors:[{id:'1',penName:'합성 작가',status:'APPROVED',payee,summary}],sources:[{allocationId:pid,purchaseId:other,authorId:'1',authorName:'합성 작가',workId:'1',workTitle:'합성 작품',sourceAmountKrw:1000,points:1000,createdAt:'2026-11-02T00:00:00Z',orderStatus:'PAID',eligible:true,earningId:null}]};let actor=who;
 const window={WEBNOVELS_CONFIG:{settlementsTestEnabled:enabled},WebNovelsAuth:{getActor:()=>actor,api:async(url,init)=>{const q=new URL(url,'https://site.test').searchParams,action=q.get('action'),payload=init?.body?JSON.parse(init.body):Object.fromEntries([...q].filter(([k])=>k!=='action'));calls.push({action,data:payload,init});const custom=await handler?.(action,payload,data);if(custom!==undefined)return custom;if(action==='state')return data.state;if(action==='summary')return data.overview;if(action==='requests')return page([data.payout]);if(action==='detail'||action==='request-detail')return {...marker,payout:data.payout};if(action==='earnings')return page(data.earnings);if(action==='authors')return page(data.authors);if(action==='sources')return page(data.sources);return {...marker,payout:data.payout,summary,replayed:false};}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t)},crypto:{randomUUID},URLSearchParams,Date,console});const mod=window[isAdmin?'AdminPayoutsTest':'AuthorPayoutsTest'];return {root,calls,data,window,mod,render:()=>mod.render(root),switch:()=>{actor={...who,userId:other};}};
}
test('disabled and wrong-role screens issue no financial requests',async()=>{
 for(const isAdmin of [true,false]){const a=fixture({isAdmin,enabled:false});await a.render();assert.equal(a.calls.length,0);assert.match(a.root.textContent,/준비/);}
 for(const who of [{...author,author:{id:'1',status:'SUSPENDED'}},{...admin,admin:{role:'SUB_ADMIN',is_active:true}}]){const a=fixture({isAdmin:!!who.admin,who});await a.render();assert.equal(a.calls.length,0);}
});
test('author sees real server totals and explicitly requests current policy and payee revision',async()=>{
 const a=fixture();await a.render();assert.match(a.root.textContent,/700원/);assert.equal(a.calls.length,1);field(a,'신청 금액 (원)').value='500';await button(a,'정산 TEST 신청').onclick();const request=a.calls.find(c=>c.action==='request');assert.equal(request.data.amountKrw,500);assert.equal(request.data.policyVersion,pid);assert.equal(request.data.payeeRevision,'1');assert.deepEqual(Object.keys(request.data).sort(),['amountKrw','payeeRevision','policyVersion','requestId']);
});
test('blocked readiness and excess amount cannot create requests',async()=>{
 const a=fixture();a.data.overview.eligibility.canRequest=false;await a.render();assert.equal(button(a,'정산 TEST 신청').disabled,true);field(a,'신청 금액 (원)').value='500';await button(a,'정산 TEST 신청').onclick();assert(!a.calls.some(c=>c.action==='request'));
 const b=fixture();await b.render();field(b,'신청 금액 (원)').value='701';await button(b,'정산 TEST 신청').onclick();assert(!b.calls.some(c=>c.action==='request'));assert.match(b.root.textContent,/초과|가능액/);
});
test('timeout and HTTP408 retry exactly the same request, blocking new writes',async()=>{
 for(const status of [undefined,408]){let writes=0;const a=fixture({handler(action){if(action==='request'&&++writes===1)throw Object.assign(Error('lost response'),{status,code:'EDGE_TIMEOUT'});}});await a.render();field(a,'신청 금액 (원)').value='500';await button(a,'정산 TEST 신청').onclick();assert.equal(button(a,'정산 TEST 신청').disabled,true);assert.equal(button(a,'미확인 요청 다시 확인').hidden,false);await button(a,'미확인 요청 다시 확인').onclick();const req=a.calls.filter(c=>c.action==='request');assert.equal(req.length,2);assert.deepEqual(req[0].data,req[1].data);}
});
test('recognized policy conflict clears pending and refreshes conditions before another request',async()=>{
 const a=fixture({handler(action){if(action==='request')throw Object.assign(Error(),{status:409,code:'PAYOUT_POLICY_CHANGED'});}});await a.render();field(a,'신청 금액 (원)').value='100';await button(a,'정산 TEST 신청').onclick();assert.equal(button(a,'미확인 요청 다시 확인').hidden,true);assert.match(a.root.textContent,/정책이 변경/);
});
test('navigation preserves unresolved request while logout discards it and late data',async()=>{
 let done;const waiting=new Promise(r=>done=r),a=fixture({handler(action){if(action==='request')return waiting;}});await a.render();field(a,'신청 금액 (원)').value='500';const op=button(a,'정산 TEST 신청').onclick();a.mod.leave();await a.render();assert.equal(button(a,'미확인 요청 다시 확인').hidden,false);done({...marker,replayed:false,payout:payout(),summary});await op;assert.equal(button(a,'미확인 요청 다시 확인').hidden,false);a.mod.reset();a.switch();await a.render();assert.equal(button(a,'미확인 요청 다시 확인').hidden,true);
});
test('author statements include deductions and no unsafe HTML assignment',async()=>{
 const a=fixture();a.data.earnings=[earning({workTitle:'<img src=x onerror=alert(1)>',adjustedKrw:10,availableNetKrw:690,adjustments:[{id:eid,amountKrw:10,reason:'거래 대조 감액',createdAt:'2026-11-02T00:00:00Z'}]})];await a.render();await button(a,'확정 수익 명세').onclick();assert.match(a.root.textContent,/690원/);assert.match(a.root.textContent,/거래 대조 감액/);assert.equal(all(a.root).some(n=>n.tag==='img'),false);
});
test('admin approval does not show payment completion and UNKNOWN only supports evidence reconciliation',async()=>{
 const a=fixture({isAdmin:true});await a.render();await button(a,'신청 상세').onclick();assert(button(a,'정산 승인'));assert(!button(a,'TEST 지급 증빙 확인'));field(a,'처리 사유').value='조건 대조 확인';await button(a,'정산 승인').onclick();assert.equal(a.calls.filter(c=>c.action==='approve').length,1);assert(!a.calls.some(c=>c.action==='paid'));
 a.data.payout=payout({status:'UNKNOWN',approvedAt:'2026-11-02T00:01:00Z',dispatchedAt:'2026-11-02T00:02:00Z'});await a.render();await button(a,'신청 상세').onclick();assert(!button(a,'신청 취소'));assert(!button(a,'반려'));assert(!button(a,'TEST 지급 결과 확인 시작'));assert(button(a,'TEST 지급 증빙 확인'));assert.match(a.root.textContent,/금액은 예약/);
});
test('admin payment evidence sends explicit amount frozen target reference and KST converted UTC',async()=>{
 const a=fixture({isAdmin:true});a.data.payout=payout({status:'UNKNOWN',dispatchedAt:'2026-11-02T00:00:00Z'});await a.render();await button(a,'신청 상세').onclick();field(a,'처리 사유').value='모의 지급 증빙 대조';field(a,'TEST 거래 증빙 참조').value='TEST-transaction';field(a,'증빙의 TEST 지급 대상').value='TEST-author-1';field(a,'증빙의 지급 금액 (원)').value='500';field(a,'지급 일시 (한국 시간)').value='2026-11-02T09:05';await button(a,'TEST 지급 증빙 확인').onclick();const call=a.calls.find(c=>c.action==='paid');assert.equal(call.data.paidAt,'2026-11-02T00:05:00.000Z');assert.equal(call.data.amountKrw,500);assert.equal(call.data.testReference,payee.testReference);assert(!('accountNumber'in call.data));
});
test('admin can discover authors and source earnings without entering raw IDs',async()=>{
 const a=fixture({isAdmin:true});await a.render();await button(a,'작가·지급 대상').onclick();assert.match(a.root.textContent,/합성 작가/);await button(a,'소비 수익 보기').onclick();assert.equal(a.calls.find(c=>c.action==='sources').data.authorId,'1');field(a,'수익 확정 사유').value='원충전 소비 대조';await button(a,'이 소비 수익 확정').onclick();const c=a.calls.find(c=>c.action==='confirm');assert.equal(c.data.allocationId,pid);assert.equal(c.data.policyVersion,pid);
});
test('admin deduction flow uses server earning id, explicit amount and reason',async()=>{
 const a=fixture({isAdmin:true});await a.render();await button(a,'확정 명세·감액').onclick();field(a,'감액 금액 (원)').value='100';field(a,'감액 근거·사유').value='분쟁 근거 대조';await button(a,'수익 감액 기록').onclick();const c=a.calls.find(c=>c.action==='adjust');assert.equal(c.data.earningId,eid);assert.equal(c.data.amountKrw,100);assert.equal(c.data.reason,'분쟁 근거 대조');
});
test('controls are labelled native buttons and status is announced, CSS accommodates keyboard and narrow display',async()=>{
 const a=fixture({isAdmin:true});await a.render();await button(a,'정산 정책').onclick();for(const input of all(a.root).filter(n=>['input','select'].includes(n.tag)))assert(all(a.root).some(n=>n.tag==='label'&&n.children.includes(input)));assert(all(a.root).some(n=>n.attrs.role==='status'&&n.attrs['aria-live']==='polite'));
 const css=readFileSync(new URL('../public/css/payouts-test.css',import.meta.url),'utf8');assert.match(css,/:focus-visible/);assert.match(css,/overflow-x:auto/);assert.match(css,/min-height:44px/);
});
