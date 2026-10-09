import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(new URL('../public/js/core/purchase-contract.js',import.meta.url));
const source=await readFile(filename,'utf8');
function setup(){
 const doc={createElement:tag=>({tag,textContent:''})};const target={ownerDocument:doc,children:[],replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
 const c={window:{}};vm.createContext(c);vm.runInContext(source,c,{filename});return {ui:c.window.PurchaseContract,target,text:()=>target.children.map(n=>n.textContent).join('\n')};
}
const q={mode:'TEST',provenance:'LOCAL_SIMULATED',liveContentAccess:false,currency:'KRW',amountKrw:100,
 accessKind:'OWN',durationHours:null,terms:'<img onerror=alert(1)> 시험 정책',policyVersion:'fixture-v1',freeScope:'무료 회차 범위 확인'};
test('quote renderer exposes price/free scope/own or rental period and uses inert text nodes',()=>{
 const {ui,target,text}=setup();assert.equal(ui.renderQuote(target,q),true);assert.match(text(),/100원/);assert.match(text(),/기간 제한 없음/);assert.match(text(),/무료 회차/);
 assert.match(text(),/<img onerror/);assert.ok(target.children.every(n=>n.innerHTML===undefined));
 ui.renderQuote(target,{...q,accessKind:'RENT',durationHours:24});assert.match(text(),/승인 시점부터 24시간/);
 for(const patch of [{mode:'LIVE'},{liveContentAccess:true},{amountKrw:0},{currency:'USD'},{accessKind:'RENT',durationHours:0},{terms:null}])assert.equal(ui.renderQuote(target,{...q,...patch}),false);
});
test('uncertain/refund states guide server requery and never imply real content access',()=>{
 const {ui,target,text}=setup();for(const status of ['UNKNOWN','REFUND_UNKNOWN','APPROVING','REFUNDING','REVIEW']){
  assert.ok(ui.renderOrder(target,{mode:'TEST',liveContentAccess:false,status,amountKrw:100}));assert.match(text(),/재구매하기 전에 서버 조회/);
 }
 for(const status of ['CREATED','PAID','REFUNDED','FAILED']){assert.ok(ui.renderOrder(target,{mode:'TEST',liveContentAccess:false,status,amountKrw:100,expiresAt:'bad'}));assert.match(text(),/실제 독자 본문에 적용되지/);}
 assert.equal(ui.renderOrder(target,{mode:'LIVE',status:'PAID'}),false);assert.equal(ui.renderOrder(target,{mode:'TEST',liveContentAccess:false,status:'FAKE'}),false);
});
test('earnings distinguish unavailable estimates, test-confirmed and zero payable/paid; no checkout/network/storage side effects',()=>{
 const {ui,target,text}=setup();const d={mode:'TEST',confirmedTestKrw:68,payableKrw:0,paidKrw:0,payoutStatus:'NOT_AVAILABLE'};
 assert.ok(ui.renderEarnings(target,d));assert.match(text(),/예상 수익: 집계 전/);assert.match(text(),/확정 시험액: 68원/);assert.match(text(),/지급 가능: 0원/);assert.match(text(),/정산을 신청할 수 없습니다/);
 assert.equal(ui.renderEarnings(target,{...d,paidKrw:100}),false);assert.equal(ui.renderEarnings(target,{...d,confirmedTestKrw:null}),false);
 assert.ok(!/fetch\(|localStorage|innerHTML|requestPayment|unlockEpisode/.test(source));
});
