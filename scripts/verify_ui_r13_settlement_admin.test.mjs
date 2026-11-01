import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/admin/admin-settlement-review.js',import.meta.url),'utf8');
const consoleSource=await readFile(new URL('../public/js/admin/admin-console.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this._text='';this.attributes={};this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.isConnected=true;}
 set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){throw Error('Sensitive information must never use innerHTML');}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 setAttribute(name,value){this.attributes[name]=String(value);}removeAttribute(name){delete this.attributes[name];if(name==='src')this.src='';}
 querySelectorAll(selector){return all(this).slice(1).filter(node=>selector.split(',').some(tag=>node.tagName===tag.toUpperCase()));}
}
const all=root=>[root,...root.children.flatMap(all)];
const findButton=(root,label)=>all(root).find(n=>n.tagName==='BUTTON'&&n.textContent===label);
const field=(root,label)=>{const found=all(root).find(n=>n.tagName==='LABEL'&&n.textContent.startsWith(label));return found&&all(found).find(n=>['INPUT','TEXTAREA'].includes(n.tagName));};
const click=async(root,label)=>{const node=findButton(root,label);assert(node,'missing button '+label);if(!node.disabled)await node.onclick?.();return node;};
const submit=async form=>form.onsubmit({preventDefault(){}});
const application={authorId:'9007199254740993',penName:'비즈피어 <img onerror=1>',revision:'2',status:'PENDING',applicantType:'CORPORATION',documentType:'PASSPORT',submittedAt:'2026-11-01T00:00:00Z',documentAvailable:true};
const details=()=>({legalName:'실명 <script>alert(1)</script>',birthDate:'1990-01-01',postalCode:'01234',address:'검토용 주소',addressDetail:'1층',companyName:'법인명',businessNumber:'1234567890',identityImage:{mime:'image/jpeg',data:'/9j/2Q=='},businessImage:{mime:'image/png',data:'iVBORw0KGgo='}});
function setup({who={userId:'admin-a',admin:{role:'SUPER_ADMIN',is_active:true}},handler,items=[application],total=items.length,withConsole=false}={}){
 let current=true;const root=new Node(),calls=[],created=[],revoked=[],windowEvents={},documentEvents={};
 const context={Date,Uint8Array,Blob,atob,crypto:webcrypto,URL:{createObjectURL:blob=>{const id='blob:private-'+(created.length+1);created.push({id,blob});return id;},revokeObjectURL:id=>revoked.push(id)},
  document:{createElement:tag=>new Node(tag),addEventListener:(name,fn)=>{documentEvents[name]=fn;},visibilityState:'visible'},addEventListener:(name,fn)=>{windowEvents[name]=fn;},URLSearchParams,
  WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{calls.push({path,options});if(handler)return handler(path,options,calls.length);
   if(path.includes('/console?'))return {items:[],total:0};
   if(!options)return {applications:copy(items),total,offset:0,pageSize:30};
   if(path.endsWith('/reveal'))return {details:details(),application:copy(application)};
   return {application:{...copy(application),revision:'3',status:JSON.parse(options.body).decision}};
  }}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'admin-settlement-review.js'});if(withConsole)vm.runInContext(consoleSource,context,{filename:'admin-console.js'});
 return {root,context,calls,created,revoked,windowEvents,documentEvents,setActor:value=>{who=value;},setCurrent:value=>{current=value;},render:()=>context.AdminSettlementReview.render(root,{isCurrent:()=>current}),review:context.AdminSettlementReview};
}
async function reveal(s){await s.render();await click(s.root,'서류 열람');field(s.root,'열람 사유').value='신청 증빙 확인';field(s.root,'현재 최고 관리자 비밀번호').value='secret';await submit(all(s.root).find(n=>n.tagName==='FORM'));}
function readyReview(s){all(s.root).find(n=>n.tagName==='INPUT'&&n.type==='checkbox').checked=true;field(s.root,'검토 사유').value='제출 증빙과 입력 정보를 대조했습니다';field(s.root,'현재 최고 관리자 비밀번호 (결과 저장').value='secret';}

test('only active SUPER_ADMIN can fetch metadata; ordinary settlement readers never fetch private registration',async()=>{
 for(const who of [null,{userId:'reader',reader:{id:'1'}},{userId:'moderator',admin:{role:'SUB_ADMIN',permissions:['AUTHOR_SETTLEMENT','SETTLEMENTS_READ'],is_active:true}},{userId:'disabled',admin:{role:'SUPER_ADMIN',is_active:false}}]){
  const s=setup({who});await s.render();assert.equal(s.calls.length,0);assert.match(s.root.textContent,/최고 관리자 권한/);
 }
 const s=setup();await s.render();assert.equal(s.calls.length,1);assert.match(s.root.textContent,/법인.*여권/);assert.match(s.root.textContent,/<img onerror=1>/);assert.equal(all(s.root).filter(n=>n.tagName==='IMG').length,0);assert.doesNotMatch(s.root.textContent,/검토용 주소|1990-01-01/);
});

test('reveal requires reason and current password and paints inert allowlisted text with private blob images',async()=>{
 const s=setup();await s.render();await click(s.root,'서류 열람');const form=all(s.root).find(n=>n.tagName==='FORM');await submit(form);assert.equal(s.calls.length,1);
 field(s.root,'열람 사유').value='신청 증빙 확인';const pw=field(s.root,'현재 최고 관리자 비밀번호');pw.value='secret';await submit(form);
 assert.equal(pw.value,'');assert.equal(s.calls.length,2);assert.match(s.calls[1].path,/9007199254740993\/reveal$/);assert.equal(JSON.parse(s.calls[1].options.body).revision,'2');
 assert.match(s.root.textContent,/실명 <script>/);assert.match(s.root.textContent,/검토용 주소/);const images=all(s.root).filter(n=>n.tagName==='IMG');assert.equal(images.length,2);assert(images.every(n=>n.src.startsWith('blob:private-')));assert.equal(s.created.length,2);
 assert.match(s.root.textContent,/PASS 인증·은행 예금주 확인·정산 지급 완료를 뜻하지 않습니다/);
});

test('successful manual review clears images and plaintext and disables consumed metadata without claiming payout approval',async()=>{
 const s=setup();await reveal(s);const displayed=all(s.root).filter(n=>n.tagName==='DD'),images=all(s.root).filter(n=>n.tagName==='IMG');readyReview(s);await click(s.root,'서류 확인 완료');
 assert.equal(s.calls.length,3);assert.match(s.root.textContent,/서류 확인을 완료했습니다.*실제 지급과 계좌 확인은 별도/);assert.doesNotMatch(s.root.textContent,/검토용 주소|실명 <script>/);assert.equal(s.revoked.length,2);assert(displayed.every(n=>n.textContent===''));assert(images.every(n=>!n.src));
 assert.equal(findButton(s.root,'서류 열람').disabled,true);const write=s.calls[2];assert.equal(JSON.parse(write.options.body).decision,'APPROVED');assert.match(write.options.headers['Idempotency-Key'],/^[0-9a-f-]{36}$/);
});

test('review demands direct inspection confirmation, note and a new password; notes render as text',async()=>{
 const s=setup();await reveal(s);await click(s.root,'서류 확인 완료');assert.equal(s.calls.length,2);
 readyReview(s);const note=field(s.root,'검토 사유');note.value='식별 번호를 가려서 다시 제출해주세요';await click(s.root,'보완 요청');assert.equal(JSON.parse(s.calls[2].options.body).decision,'NEEDS_CHANGES');assert.match(s.root.textContent,/보완을 요청했습니다.*새로 제출/);assert.equal(s.revoked.length,2);
});

test('lost review response retries immutable business payload and key, with cleared and re-entered password',async()=>{
 let attempts=0;const s=setup({handler:(path,options)=>{if(!options)return {applications:[copy(application)],total:1,pageSize:30};if(path.endsWith('/reveal'))return {details:details(),application:copy(application)};if(++attempts===1)throw Error('network lost');return {application:{...application,revision:'3',status:JSON.parse(options.body).decision}};}});
 await reveal(s);readyReview(s);const note=field(s.root,'검토 사유'),password=field(s.root,'현재 최고 관리자 비밀번호 (결과 저장');await click(s.root,'서류 확인 완료');assert.equal(password.value,'');assert.equal(note.disabled,true);assert.equal(findButton(s.root,'보완 요청').disabled,true);
 note.value='tampered value';await click(s.root,'서류 확인 완료');assert.equal(s.calls.length,3,'retry requires reauthentication');password.value='new secret';await click(s.root,'서류 확인 완료');
 const writes=s.calls.filter(call=>call.path.endsWith('/review'));assert.equal(writes.length,2);assert.equal(writes[0].options.headers['Idempotency-Key'],writes[1].options.headers['Idempotency-Key']);const [a,b]=writes.map(call=>JSON.parse(call.options.body));delete a.password;delete b.password;assert.deepEqual(a,b);assert.equal(a.note,'제출 증빙과 입력 정보를 대조했습니다');assert.equal(s.revoked.length,2);
});

test('close, reset, hidden page and disconnected view erase revealed data and revoke each image exactly once',async()=>{
 for(const action of ['close','reset','hidden','pagehide']){const s=setup();await reveal(s);const nodes=all(s.root).filter(n=>n.tagName==='DD');if(action==='close')await click(s.root,'서류 확인 닫기');if(action==='reset')s.review.reset();if(action==='hidden'){s.context.document.visibilityState='hidden';s.documentEvents.visibilitychange();}if(action==='pagehide')s.windowEvents.pagehide();assert.equal(s.revoked.length,2,action);assert(nodes.every(n=>n.textContent===''),action);assert.doesNotMatch(s.root.textContent,/검토용 주소|실명 <script>/,action);s.review.reset();assert.equal(s.revoked.length,2,action);}
});

test('late reveal after account switch, permission loss, close, reset or navigation never paints private fields',async()=>{
 for(const change of ['account','permission','close','reset','navigation','disconnect']){
  const pending=gate(),s=setup({handler:(path,options)=>!options?{applications:[copy(application)],total:1,pageSize:30}:pending.promise});await s.render();await click(s.root,'서류 열람');field(s.root,'열람 사유').value='증빙 확인 사유';field(s.root,'현재 최고 관리자 비밀번호').value='secret';const loading=submit(all(s.root).find(n=>n.tagName==='FORM'));
  if(change==='account')s.setActor({userId:'other-admin',admin:{role:'SUPER_ADMIN',is_active:true}});if(change==='permission')s.setActor({userId:'admin-a',admin:{role:'SUB_ADMIN',permissions:['SETTLEMENTS_READ'],is_active:true}});if(change==='close')await click(s.root,'서류 확인 닫기');if(change==='reset')s.review.reset();if(change==='navigation')s.setCurrent(false);if(change==='disconnect')s.root.isConnected=false;
  pending.resolve({details:details(),application:copy(application)});await loading;assert.equal(s.created.length,0,change);assert.doesNotMatch(s.root.textContent,/검토용 주소|실명 <script>/,change);
 }
});

test('revision conflict has no false approval; malformed image or foreign response never reveals information',async()=>{
 for(const failure of ['foreign','image']){const s=setup({handler:(path,options)=>!options?{applications:[copy(application)],total:1,pageSize:30}:{details:failure==='image'?{...details(),identityImage:{mime:'image/svg+xml',data:'PHN2Zz4='}}:details(),application:{...application,authorId:failure==='foreign'?'1':application.authorId}}});await reveal(s);assert.equal(s.created.length,0,failure);assert.doesNotMatch(s.root.textContent,/검토용 주소|실명 <script>/,failure);}
 const s=setup({handler:(path,options)=>{if(!options)return {applications:[copy(application)],total:1,pageSize:30};if(path.endsWith('/reveal'))return {details:details(),application:copy(application)};throw Object.assign(Error('conflict'),{status:409,code:'SETTLEMENT_CONFLICT'});}});await reveal(s);readyReview(s);await click(s.root,'서류 확인 완료');assert.match(s.root.textContent,/신청 또는 계좌 정보가 변경/);assert.equal(findButton(s.root,'서류 열람').disabled,true);assert.doesNotMatch(s.root.textContent,/서류 확인을 완료했습니다|검토용 주소/);assert.equal(s.revoked.length,2);
});

test('pagination fetches the next bounded page and consumed or expired records cannot open images',async()=>{
 const s=setup({items:[{...application,status:'EXPIRED',documentAvailable:false}],total:31});await s.render();assert.equal(findButton(s.root,'서류 열람').disabled,true);await click(s.root,'다음 신청');assert.equal(s.calls[1].path,'/api/v2/admin/settlements/identity?offset=30');assert.equal(findButton(s.root,'이전 신청').disabled,false);
});

test('admin console mounts private review for SUPER_ADMIN and disposes it on page navigation and reset',async()=>{
 const s=setup({withConsole:true});await s.context.AdminConsole.render(s.root,'settlements');assert(s.calls.some(call=>call.path.includes('/settlements/identity')));assert(s.calls.some(call=>call.path.includes('/console?')));await click(s.root,'서류 열람');field(s.root,'열람 사유').value='신청 증빙 대조';field(s.root,'현재 최고 관리자 비밀번호').value='secret';await submit(all(s.root).find(n=>n.tagName==='FORM'));assert.equal(s.created.length,2);await s.context.AdminConsole.render(s.root,'audit');assert.equal(s.revoked.length,2);assert.doesNotMatch(s.root.textContent,/검토용 주소/);s.context.AdminConsole.reset();
 const denied=setup({withConsole:true,who:{userId:'moderator',admin:{role:'SUB_ADMIN',is_active:true,permissions:['SETTLEMENTS_READ']}}});await denied.context.AdminConsole.render(denied.root,'settlements');assert(denied.calls.every(call=>!call.path.includes('/settlements/identity')));
});
