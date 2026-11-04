import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync('public/js/shared/live-commerce.js','utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};this.style={};this.files=[];this._text='';}
 append(...nodes){for(const n of nodes)n.parent=this;this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}setAttribute(k,v){this.attrs[k]=v;}
 querySelector(sel){return all(this).find(n=>n.attrs[sel.slice(1,-1)]!==undefined)||null;}set innerHTML(_){assert.fail('unsafe DOM');}
}
test('OP15 admin selects original deposits and explicit amounts, clearing password after submission',async()=>{
 const depositId=randomUUID(),orderId=randomUUID(),planId=randomUUID();const f=fixture(d=>d.action==='funding-list'?{deposits:[{id:depositId,orderId,amount:12000,available:'12000'}],plans:[{id:planId,kind:'RETURN',orderId,amount:2000,reasonRef:'synthetic',status:'RETURN_APPROVED',sources:[{depositId,amount:2000}]}]}:d.action==='notification-list'?{deliveryEnabled:false,items:[]}:undefined);
 await f.render();const request=form(f,'부분 입금 합산·주문 재연결');assert(request);field(request,'충전할 주문 ID').value=orderId;field(request,'대조·반환 근거 문서 참조').value='bank-checked';
 const selected=all(request).find(n=>n.tag==='input'&&n.type==='checkbox'&&n.parent.textContent.startsWith('입금 '));selected.checked=true;field(request,'배분액 (원)').value='10000';field(request,'관리자 비밀번호 재확인').value='synthetic';
 await request.onsubmit({preventDefault(){}});const sent=f.calls.find(x=>x.action==='funding-propose');assert.deepEqual(sent.sources,[{depositId,amount:10000}]);assert.equal(sent.orderId,orderId);assert.equal(sent.kind,'CREDIT');assert.equal(field(request,'관리자 비밀번호 재확인').value,'');assert(form(f,'외부 반환 송금 완료 기록'));assert.match(f.root.textContent,/외부 발송 비활성/);
 f.window.LiveCommerce.reset();assert.equal(f.root.textContent,'');
});
test('OP15 TEST notification controls preserve expected revision and never label mail as sent',async()=>{
 const id=randomUUID();const f=fixture(d=>d.action==='funding-list'?{deposits:[],plans:[]}:d.action==='notification-list'?{deliveryEnabled:false,items:[{id,eventType:'POINTS_CREDITED',targetId:randomUUID(),attempt:1,outcome:'TEST_RETRY'}]}:undefined);
 await f.render();const retry=form(f,'준비 완료 상태 시험');field(retry,'관리자 비밀번호 재확인').value='synthetic';await retry.onsubmit({preventDefault(){}});const sent=f.calls.find(x=>x.action==='notification-test');assert.equal(sent.expectedAttempt,1);assert.equal(sent.outcome,'TEST_READY');assert.match(f.root.textContent,/실제 발송 완료를 기록하지 않습니다/);assert(!/innerHTML|localStorage|sessionStorage|fetch\(/.test(code));
});
const all=n=>[n,...n.children.flatMap(all)],form=(f,title)=>all(f.root).find(n=>n.tag==='form'&&n.parent.children[0]?.textContent===title),field=(root,label)=>all(root).find(n=>n.tag==='label'&&n.children[0]?.textContent===label)?.children[1];
function fixture(handler){
 const root=new Element('div'),calls=[],revoked=[],timers=[],blobs=[],who={userId:randomUUID(),admin:{role:'SUPER_ADMIN',is_active:true}};
 const state={orders:[],works:[],payouts:[],corrections:[],policy:{enabled:true,hash:'b'.repeat(64),version:'synthetic',text:'합성 정책'}};
 const ready={activeSuperAdmins:2,openCases:'0',pendingProofs:'0',documentKeys:[{version:'v1',count:'1'}],configuration:{keys:{activeVersion:'v2',readVersions:['v1','v2']},smtp:{configurationPresent:false},hostedRestoreEvidencePresent:false,bankAcceptanceEvidencePresent:false}};
 const window={WEBNOVELS_CONFIG:{liveCommerceEnabled:true},WebNovelsAuth:{getActor:()=>who,api:async(_url,init)=>{const data=JSON.parse(init.body);calls.push(data);return await handler?.(data)??(data.action==='exceptions'?{items:[]}:data.action==='month-list'?{reports:[]}:data.action==='operations-readiness'?ready:state);}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t),querySelectorAll:sel=>all(root).filter(n=>n.attrs[sel.slice(1,-1)]!==undefined)},crypto:{randomUUID},Uint8Array,Blob,btoa,atob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:synthetic';},revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
 return {root,calls,revoked,timers,blobs,who,window,render:async()=>{await window.LiveCommerce.render(root,{role:'admin'});await all(root).find(n=>n.tag==='button'&&n.textContent==='입금 배분·반환·알림 준비 열기').onclick();}};
}
