import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync('public/js/shared/settlement-readiness.js','utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};this.style={};this.files=[];this._text='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this._text='';}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}setAttribute(k,v){this.attrs[k]=v;}
 set innerHTML(_){assert.fail('unsafe DOM');}
}
const all=n=>[n,...n.children.flatMap(all)],button=(f,label)=>all(f.root).find(n=>n.tag==='button'&&n.textContent===label),field=(f,label)=>all(f.root).find(n=>n.tag==='label'&&n.children[0]?.textContent===label)?.children[1];
function fixture({admin=true,enabled=true,handler}={}){
 const root=new Element('div'),calls=[],revoked=[],timers=[];let who={userId:randomUUID(),author:{id:'1',status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}};
 const facts={authorId:'1',binding:'a'.repeat(64),bankRegistered:true,identityApproved:true,bankConfirmed:false,bankRevision:'2',identityRevision:'1',canPay:false,sourceStatus:'UNCONNECTED',payableKrw:null,blockers:['BANK_REVIEW_REQUIRED','LIVE_REVENUE_UNCONNECTED','PAYOUT_RELEASE_NOT_APPROVED']};
 const detail={mode:'PREPARATION',canPay:false,facts,bank:{bankName:'합성 은행',holder:'합성 신청인',maskedNumber:'**** 1234'},snapshots:[],reviews:[],policy:{collectionEnabled:true,version:'synthetic',hash:'b'.repeat(64),text:'합성 증빙 정책'}};
 const window={WEBNOVELS_CONFIG:{settlementReadinessEnabled:enabled},WebNovelsAuth:{getActor:()=>who,api:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});const result=await handler?.(body,detail);if(result!==undefined)return result;if(body.action==='list')return {items:[{authorId:'1',penName:'합성 작가',facts}]};if(body.action==='detail')return structuredClone(detail);return {mode:'PREPARATION',canPay:false,saved:true,replayed:false};}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t)},crypto:{randomUUID},console,Uint8Array,Blob,btoa,atob,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
 return {root,calls,detail,window,revoked,timers,render:()=>window.SettlementReadiness.render(root,{admin}),reset:()=>window.SettlementReadiness.reset(),switch:()=>{who={...who,userId:randomUUID()};}};
}
test('closed gate has no request; author receives preparation status without amount or management controls',async()=>{
 const closed=fixture({enabled:false});await closed.render();assert.equal(closed.calls.length,0);assert.match(closed.root.textContent,/연결 전/);
 const f=fixture({admin:false});await f.render();assert.match(f.root.textContent,/실제 정산 가능 금액: 연결 전/);assert(!button(f,'현재 계좌 수동 확인 기록'));assert(!button(f,'이 달의 준비 상태 기록'));assert.deepEqual(f.calls[0].body,{action:'detail'});assert(!all(f.root).some(n=>n.type==='password'));
});
test('administrator search is one bounded request and snapshot lost response reuses request without payment action',async()=>{
 let writes=0;const f=fixture({handler:b=>{if(b.action==='snapshot'&&++writes===1)throw Error('lost');}});await f.render();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.offset,0);
 await button(f,'정산 준비 상세').onclick();await button(f,'이 달의 준비 상태 기록').onclick();assert.equal(button(f,'미확인 기록 같은 요청으로 재확인').hidden,false);
 await button(f,'미확인 기록 같은 요청으로 재확인').onclick();const requests=f.calls.filter(c=>c.body.action==='snapshot');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);assert(!f.calls.some(c=>['paid','complete','transfer'].includes(c.body.action)));
});
test('evidence upload requires confirmation; async double click is suppressed and password cleared',async()=>{
 const f=fixture();await f.render();await button(f,'정산 준비 상세').onclick();await button(f,'현재 계좌 수동 확인 기록').onclick();assert(!f.calls.some(c=>c.body.action==='confirm'));
 field(f,'현재 등록된 예금주·은행·계좌를 별도 자료와 대조했고 보존 정책을 확인했습니다').checked=true;
 let finish;const pending=new Promise(r=>finish=r);field(f,'번호를 가린 계좌 확인 증빙 (JPEG/PNG, 150KB 이하)').files=[{type:'image/png',size:30,arrayBuffer:()=>pending}];
 const password=field(f,'계좌 확인·증빙 열람용 관리자 비밀번호');password.value='synthetic-secret';const submit=button(f,'현재 계좌 수동 확인 기록'),one=submit.onclick();await submit.onclick();finish(new Uint8Array([1,2,3]).buffer);await one;
 assert.equal(f.calls.filter(c=>c.body.action==='confirm').length,1);assert.equal(password.value,'');assert(!f.root.textContent.includes('synthetic-secret'));
});
test('private image closes on timeout or reset and late responses cannot cross account boundaries',async()=>{
 const f=fixture({handler:b=>b.action==='reveal'?{image:{mime:'image/png',data:'aGVsbG8='}}:undefined});f.detail.reviews=[{id:randomUUID(),createdAt:'synthetic',documentAvailable:true,revoked:false}];await f.render();await button(f,'정산 준비 상세').onclick();field(f,'계좌 확인·증빙 열람용 관리자 비밀번호').value='synthetic';await button(f,'은행 증빙 열람').onclick();assert(all(f.root).some(n=>n.tag==='img'));f.timers.at(-1)();assert(!all(f.root).some(n=>n.tag==='img'));assert(f.revoked.length);
 let resolve;const waiting=new Promise(r=>resolve=r),g=fixture({admin:false,handler:()=>waiting}),started=g.render();g.reset();g.switch();resolve(g.detail);await started;assert.equal(g.root.textContent,'');
});
test('loader and lifecycle include both roles, use safe text and provide no public money or proof mutation shortcuts',()=>{
 const loader=readFileSync('public/js/core/role-modules.js','utf8');assert.equal((loader.match(/settlement-readiness\.js\?v=20261102op12/g)||[]).length,2);
 for(const p of ['public/js/core/auth-session.js','public/js/creator/creator-dashboard.js','public/js/admin/admin-console.js'])assert(readFileSync(p,'utf8').includes('SettlementReadiness?.reset()'));
 assert(!/innerHTML|localStorage|sessionStorage|fetch\(/.test(code));assert(code.includes("status.setAttribute('role','status')"));assert(code.includes("img.alt='가림 처리한 계좌 확인 증빙'"));
});
