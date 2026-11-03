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
const all=n=>[n,...n.children.flatMap(all)],form=(f,title)=>all(f.root).find(n=>n.tag==='form'&&n.parent.children[0]?.textContent===title),field=(root,label)=>all(root).find(n=>n.tag==='label'&&n.children[0]?.textContent===label)?.children[1];
function fixture(handler){
 const root=new Element('div'),calls=[],revoked=[],timers=[],blobs=[],who={userId:randomUUID(),admin:{role:'SUPER_ADMIN',is_active:true}};
 const state={orders:[],works:[],payouts:[],corrections:[],policy:{enabled:true,hash:'b'.repeat(64),version:'synthetic',text:'합성 정책'}};
 const ready={activeSuperAdmins:2,openCases:'0',pendingProofs:'0',documentKeys:[{version:'v1',count:'1'}],configuration:{keys:{activeVersion:'v2',readVersions:['v1','v2']},smtp:{configurationPresent:false},hostedRestoreEvidencePresent:false,bankAcceptanceEvidencePresent:false}};
 const window={WEBNOVELS_CONFIG:{liveCommerceEnabled:true},WebNovelsAuth:{getActor:()=>who,api:async(_url,init)=>{const data=JSON.parse(init.body);calls.push(data);return await handler?.(data)??(data.action==='exceptions'?{items:[]}:data.action==='month-list'?{reports:[]}:data.action==='operations-readiness'?ready:state);}}};
 vm.runInNewContext(code,{window,document:{createElement:t=>new Element(t),querySelectorAll:sel=>all(root).filter(n=>n.attrs[sel.slice(1,-1)]!==undefined)},crypto:{randomUUID},Uint8Array,Blob,btoa,atob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:synthetic';},revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
 return {root,calls,revoked,timers,blobs,who,window,render:async()=>{await window.LiveCommerce.render(root,{role:'admin'});await all(root).find(n=>n.tag==='button'&&n.textContent==='입금 예외·월마감·운영 준비 열기').onclick();}};
}
test('OP14 exception filters preserve source IDs and lifecycle clears private cards',async()=>{
 const id=randomUUID(),documentId=randomUUID(),f=fixture(d=>d.action==='exceptions'?{items:[{kind:'DEPOSIT',id,orderId:randomUUID(),amount:9000,documentId,reasons:['MISMATCH','EXPIRED'],cases:[],proofs:[]}]}:undefined);
 await f.render();assert.match(f.root.textContent,/금액 불일치 \/ 증빙 만료/);assert(form(f,'보류 사유 등록'));assert(form(f,'같은 은행 거래의 재증빙 제출'));
 const hold=form(f,'보류 사유 등록');field(hold,'검토 문서·문의 참조 (개인정보 제외)').value='ticket-123';field(hold,'관리자 비밀번호 재확인').value='synthetic';await hold.onsubmit({preventDefault(){}});
 const submitted=f.calls.find(c=>c.action==='case-open');assert.equal(submitted.targetId,id);assert.equal(submitted.kind,'DEPOSIT');assert(!('amount'in submitted));
 f.window.LiveCommerce.reset();assert.equal(f.root.textContent,'');
});
test('OP14 monthly preview binds digest; export uses stored snapshot, reauth and revokes Blob on close',async()=>{
 const id=randomUUID(),digest='a'.repeat(64),snapshot={schemaVersion:1,month:'2020-01',timezone:'Asia/Seoul',basis:'RECORDED_AT',events:[],totals:[]};
 const f=fixture(d=>d.action==='month-preview'?{snapshot,digest,previousId:null}:d.action==='month-list'?{reports:[{id,month:'2020-01',digest,previousId:null,actorId:randomUUID(),approved:true}]}:d.action==='month-detail'?{id,digest,previousId:null,approved:true,snapshot}:undefined);
 await f.render();const month=field(f.root,'조회 월 (한국 시간)');month.value='2020-01';await month.parent.parent.onsubmit({preventDefault(){}});
 const draft=form(f,'마감 초안 작성');field(draft,'마감 검토 근거 문서 참조').value='review-2020-01';field(draft,'관리자 비밀번호 재확인').value='synthetic';await draft.onsubmit({preventDefault(){}});const request=f.calls.find(c=>c.action==='month-draft');assert.equal(request.expectedDigest,digest);assert.equal(request.month,'2020-01');
 const detail=form(f,'마감 내역·다운로드 준비');field(detail,'관리자 비밀번호 재확인').value='synthetic';await detail.onsubmit({preventDefault(){}});assert.equal(field(detail,'관리자 비밀번호 재확인').value,'');assert.equal(f.blobs.length,1);assert.equal(JSON.parse(await f.blobs[0].text()).snapshot.month,'2020-01');
 assert(!('requestId'in f.calls.find(c=>c.action==='month-detail')));f.window.LiveCommerce.reset();assert.deepEqual(f.revoked,['blob:synthetic']);
});
test('OP14 readiness never labels unverified SMTP or real-money evidence as accepted',async()=>{
 const f=fixture();await f.render();assert.match(f.root.textContent,/메일 도착 검증 미확인/);assert.match(f.root.textContent,/실거래 인수 근거 미입력/);assert.match(f.root.textContent,/중복 판정 키 v1 유지/);
 assert(!/innerHTML|localStorage|sessionStorage|fetch\(/.test(code));
});
test('OP14 operations entry announces a failed reload rather than leaving an unhandled rejection',async()=>{
 let lists=0;const f=fixture(d=>{if(d.action==='list'&&++lists>1)throw Error('offline');});await f.render();assert.match(f.root.textContent,/처리 결과를 확인하지 못했습니다/);
});
