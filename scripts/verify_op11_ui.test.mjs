import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync('public/js/shared/payout-workflow.js','utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};this._text='';this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this._text='';}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){assert.fail('Use text nodes');}setAttribute(k,v){this.attrs[k]=v;}
 querySelectorAll(selector){assert.equal(selector,'button[data-write]');return all(this).filter(x=>x.tag==='button'&&x.attrs['data-write']);}
}
const all=n=>[n,...n.children.flatMap(all)],button=(f,t)=>all(f.root).find(n=>n.tag==='button'&&n.textContent===t),field=(f,t)=>all(f.root).find(n=>n.tag==='label'&&n.children[0]?.textContent===t)?.children[1];
function fixture({admin=true,handler,patch={}}={}){
 const root=new Element('div'),calls=[],payoutId=randomUUID();let who={userId:randomUUID(),author:{status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}},refreshes=0;
 const workflow={payoutId,method:'MANUAL',selected:false,status:'APPROVED',revision:'1',amountKrw:70,payeeReference:'TEST-original',startedAt:null,completedAt:null,proof:null,provider:null,history:[],...patch};
 const window={WebNovelsAuth:{getActor:()=>who,api:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});const result=await handler?.(body,workflow);if(result!==undefined)return result;if(body.action==='start')Object.assign(workflow,{selected:true,status:'UNKNOWN',revision:'2',startedAt:new Date().toISOString()});if(body.action==='complete')Object.assign(workflow,{status:'PAID',revision:'3',completedAt:body.paidAt,proof:{outcome:'PAID',transactionReference:body.reference,documentReference:body.documentReference}});return {mode:'TEST',livePayouts:false,workflow:structuredClone(workflow),replayed:false};}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t)},crypto:{randomUUID},console});
 return {root,calls,workflow,window,render:()=>window.PayoutWorkflow.render(root,{payout:{id:payoutId},admin,isCurrent:()=>true,onRefresh:()=>{refreshes++;}}),refreshes:()=>refreshes,switch:()=>{who={...who,userId:randomUUID()};},reset:()=>window.PayoutWorkflow.reset()};
}
test('manual-first approval requires explicit target selection; button never calls a provider',async()=>{
 const f=fixture();await f.render();assert.match(f.root.textContent,/관리자 별도 송금/);assert.match(f.root.textContent,/은행 이체를 실행하지 않습니다/);assert(!button(f,'송금 완료로 기록 · TEST'));
 field(f,'처리 사유 · 개인정보 입력 금지').value='합성 지급 대상 확인';await button(f,'수동 송금 대상 확정').onclick();assert.equal(f.workflow.status,'UNKNOWN');assert(button(f,'송금 완료로 기록 · TEST'));assert(f.calls.every(c=>c.url.includes('/payout-workflow')));assert.equal(f.refreshes(),1);
});
test('manual completion requires confirmation, matched amount, KST timestamp and separate document reference',async()=>{
 const f=fixture({patch:{status:'UNKNOWN',selected:true,revision:'2'}});await f.render();field(f,'처리 사유 · 개인정보 입력 금지').value='합성 송금 내역 대조';
 await button(f,'송금 완료로 기록 · TEST').onclick();assert(!f.calls.some(x=>x.body.action==='complete'));
 field(f,'송금 결과와 증빙을 대조했습니다').checked=true;field(f,'TEST 송금 거래 참조').value='TEST-transaction';field(f,'TEST 증빙 보관 참조').value='TEST-receipt';field(f,'증빙의 TEST 지급 대상').value='TEST-original';field(f,'증빙의 송금 금액 (원)').value='71';field(f,'송금 일시 (한국 시간)').value='2026-11-02T20:30:15';
 await button(f,'송금 완료로 기록 · TEST').onclick();assert(!f.calls.some(x=>x.body.action==='complete'));
 field(f,'증빙의 송금 금액 (원)').value='70';await button(f,'송금 완료로 기록 · TEST').onclick();const call=f.calls.find(x=>x.body.action==='complete');assert.equal(call.body.paidAt,'2026-11-02T11:30:15.000Z');assert.equal(call.body.documentReference,'TEST-receipt');assert.match(f.root.textContent,/관리자 송금 완료 기록/);
});
test('Toss/legacy review never offers a manual switch, duplicate completion or author cancel',async()=>{
 for(const admin of [true,false]){const f=fixture({admin,patch:{method:'TOSS_TEST',selected:true,provider:{state:'UNKNOWN',lastObservedAt:null}}});await f.render();assert(!button(f,'수동 송금 대상 확정'));assert(!button(f,'송금 완료로 기록 · TEST'));assert(!button(f,'신청 취소'));assert.match(f.root.textContent,/수동 송금으로 전환하지 말고/);}
});
test('lost response retry reuses identical request and refreshes parent totals; logout drops pending',async()=>{
 let writes=0;const f=fixture({handler:body=>{if(body.action==='start'&&++writes===1)throw Error('lost response');}});await f.render();field(f,'처리 사유 · 개인정보 입력 금지').value='합성 지급 시작';await button(f,'수동 송금 대상 확정').onclick();assert.equal(button(f,'미확인 처리 결과 다시 확인').hidden,false);
 await button(f,'미확인 처리 결과 다시 확인').onclick();const attempts=f.calls.filter(x=>x.body.action==='start');assert.deepEqual(attempts[0].body,attempts[1].body);assert.equal(f.workflow.status,'UNKNOWN');assert(f.refreshes()>0);f.reset();assert.equal(f.root.textContent,'');
});
test('late response cannot show private history for another actor; authored strings remain text',async()=>{
 let resolve;const waiting=new Promise(r=>resolve=r),f=fixture({handler:()=>waiting});const promise=f.render();f.reset();f.switch();resolve({mode:'TEST',livePayouts:false,workflow:f.workflow});await promise;assert.equal(f.root.textContent,'');
 const x=fixture({patch:{history:[{kind:'NOTE',note:'<img src=x onerror=alert(1)>',createdAt:new Date().toISOString()}]}});await x.render();assert.match(x.root.textContent,/<img/);assert(!all(x.root).some(n=>n.tag==='img'));assert(!/localStorage|sessionStorage|innerHTML|fetch\(/.test(code));
});
test('loader runs workflow before both owners; runtime fallback is off and legacy UI remains compatible',()=>{
 const loader=readFileSync('public/js/core/role-modules.js','utf8');assert.equal((loader.match(/payout-workflow\.js\?v=20261102op11/g)||[]).length,2);assert(loader.indexOf('payout-workflow.js?')<loader.indexOf('payouts-test.js?'));
 const shared=readFileSync('public/js/shared/payouts-test.js','utf8');assert(shared.includes('manualPayoutWorkflowEnabled===true'));assert(shared.includes('onRefresh:()=>load()'));assert(shared.includes('PayoutWorkflow?.reset()'));
 assert.match(readFileSync('public/supabase-public-config.js','utf8'),/"manualPayoutWorkflowEnabled": false/);
});
