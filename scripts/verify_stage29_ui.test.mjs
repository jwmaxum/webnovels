import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {webcrypto} from 'node:crypto';
const source=readFileSync('public/js/admin/admin-recovery.js','utf8'),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attributes={};this.value='';this.disabled=false;this.checked=false;}
 append(...n){this.children.push(...n);}replaceChildren(...n){this.children=[...n];this.textContent='';}setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(q){const tags=q.split(',');return this.children.flatMap(n=>[...(tags.includes(n.tag)?[n]:[]),...n.querySelectorAll(q)]);}
 click(){this.clicked=true;}remove(){this.removed=true;}set innerHTML(value){assert.fail('HTML insertion: '+value);}
}
const text=n=>n.textContent+' '+n.children.map(text).join(' '),btn=(s,label)=>s.root.querySelectorAll('button').find(n=>n.textContent===label),field=(s,label)=>s.root.querySelectorAll('input,textarea,select').find(n=>n.attributes['aria-label']===label);
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
const request={id,workId:'9007199254740993',episodeNumber:1,revision:'2',sourceRevision:'1',fileSha256:'a'.repeat(64)};
const detail={request,note:'<script>작가 요청',reviewRevision:'0',contextDigest:'b'.repeat(32),eligible:true,history:[]};
function setup({permission,enabled=true,handler,storage=new Map()}={}){
 const root=new Node('div'),calls=[],urls=[],revoked=[];let who={userId:'user',admin:{role:permission?'SUB_ADMIN':'SUPER_ADMIN',is_active:true,permissions:permission||[]}},isCurrent=true;
 const c={document:{createElement:t=>new Node(t)},crypto:webcrypto,URLSearchParams,URL:{createObjectURL:b=>{urls.push(b);return 'blob:private';},revokeObjectURL:u=>revoked.push(u)},
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},WEBNOVELS_CONFIG:{adminRecoveryReviewEnabled:enabled},
  WebNovelsAuth:{getActor:()=>who,api:async(url,options)=>{const q=new URL(url,'https://app.test'),action=q.searchParams.get('action'),call={action,url,options,data:options?.body?JSON.parse(options.body):null};calls.push(call);
   if(handler)return handler(call);return action==='recovery-list'?{requests:[{...request,review:{status:'PENDING'}}],hasMore:false}:action==='recovery-detail'?structuredClone(detail):action==='recovery-source'?(call.data.kind==='original'?new Blob(['bytes']):{accessId:id,title:'원고',content:'PRIVATE_SUBMITTED_BODY',authorComment:'COMMENT',revision:'2'}):{status:'HOLD'};}}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:resolve('public/js/admin/admin-recovery.js')});return {root,c,calls,storage,urls,revoked,setActor:v=>who=v,leave:()=>isCurrent=false,render:()=>c.AdminRecovery.render(root,{isCurrent:()=>isCurrent})};
}
const open=async s=>{await s.render();await btn(s,'요청 상세').onclick();};
function fill(s){field(s,'작가에게 전달할 사유 (3~500자)').value='권리 자료 보완';field(s,'검토 근거 참조·후속 확인 사항 (최대 2000자)').value='외부 근거 참조';field(s,'검토 의견을 저장하고 작가에게 전달합니다').checked=true;}
const submit=s=>s.root.querySelectorAll('form')[0].onsubmit({preventDefault(){}});
test('metadata-only read permission, disabled flags and missing permission hide all private and mutation controls',async()=>{
 const s=setup({permission:['CASE_READ']});await open(s);assert.match(text(s.root),/<script>작가 요청/);assert.equal(s.root.querySelectorAll('form').length,0);assert.equal(btn(s,'제출 원고 열람'),undefined);assert.match(text(s.root),/9007199254740993/);
 for(const args of [{enabled:false},{permission:[]}]){const x=setup(args);await x.render();assert.equal(x.calls.length,0);}
 const x=setup({permission:['CONTENT_REVIEW']});await open(x);assert.equal(x.root.querySelectorAll('form').length,1);assert.equal(btn(x,'제출 원고 열람'),undefined);assert.ok(!text(x.root).includes('후속 복원 검증 준비 ·'));
});
test('audited source and original download keep body/bytes/URL out of storage; close and reset clear private DOM',async()=>{
 const s=setup();await open(s);field(s,'비공개 자료 열람 사유 (3~500자)').value='제출 자료 검토';await btn(s,'제출 원고 열람').onclick();assert.match(text(s.root),/PRIVATE_SUBMITTED_BODY/);assert.equal(s.storage.size,0);
 await btn(s,'원고 닫기').onclick();assert.ok(!text(s.root).includes('PRIVATE_SUBMITTED_BODY'));
 field(s,'비공개 자료 열람 사유 (3~500자)').value='원본 확인';await btn(s,'원본 파일 확인·다운로드').onclick();assert.equal(s.urls.length,1);assert.deepEqual(s.revoked,['blob:private']);assert.equal(s.calls.at(-1).options.responseType,'blob');assert.equal(s.storage.size,0);
 s.c.AdminRecovery.reset();assert.equal(s.root.children.length,0);
});
test('unknown decision response preserves exact metadata/key through reopening; no fresh write overwrites pending request',async()=>{
 let fail=true;const writes=[];const s=setup({handler:call=>{if(call.action==='recovery-list')return {requests:[request]};if(call.action==='recovery-detail')return structuredClone(detail);writes.push(call);if(fail)throw Error('NETWORK');return {status:'HOLD'};}});
 await open(s);fill(s);await submit(s);assert.equal(s.storage.size,1);assert.equal(s.root.querySelectorAll('form').length,0);assert.ok(!JSON.stringify([...s.storage]).includes('PRIVATE_SUBMITTED_BODY'));
 const first=writes[0].options.body;s.c.AdminRecovery.reset();await open(s);fail=false;await btn(s,'동일 요청 결과 확인').onclick();assert.equal(writes[1].options.body,first);assert.equal(s.storage.size,0);assert.equal(s.root.querySelectorAll('form').length,1);
});
test('late source response on main-view leave or account switch cannot insert body or start download',async()=>{
 for(const mode of ['leave','account','context']){const late=deferred(),s=setup({handler:c=>c.action==='recovery-list'?{requests:[request]}:c.action==='recovery-detail'?detail:late.promise});await open(s);field(s,'비공개 자료 열람 사유 (3~500자)').value='검토 열람';const work=btn(s,'제출 원고 열람').onclick();
  await Promise.resolve();if(mode==='leave')s.c.AdminRecovery.leave('view-home');else if(mode==='account')s.setActor({userId:'other',admin:{role:'SUPER_ADMIN'}});else s.leave();
  late.resolve({accessId:id,content:'PRIVATE_SUBMITTED_BODY'});await work;assert.ok(!text(s.root).includes('PRIVATE_SUBMITTED_BODY'));assert.equal(s.urls.length,0);
 }
 const s=setup();await open(s);field(s,'비공개 자료 열람 사유 (3~500자)').value='자료 확인';await btn(s,'제출 원고 열람').onclick();s.c.AdminRecovery.leave('view-admin-cms');assert.match(text(s.root),/PRIVATE_SUBMITTED_BODY/);s.c.AdminRecovery.leave('view-home');assert.ok(!text(s.root).includes('PRIVATE_SUBMITTED_BODY'));
});
test('definitive CAS rejection allows explicit reload; permission failure keeps exact request retryable',async()=>{
 for(const code of ['RECOVERY_REVIEW_CONFLICT','PERMISSION_DENIED']){
  const s=setup({handler:c=>c.action==='recovery-list'?{requests:[request]}:c.action==='recovery-detail'?detail:Promise.reject(Object.assign(Error(code),{code,status:code==='PERMISSION_DENIED'?403:409}))});await open(s);fill(s);await submit(s);
  assert.equal(s.storage.size,1);assert.ok(btn(s,'동일 요청 결과 확인'));
  if(code==='RECOVERY_REVIEW_CONFLICT'){await btn(s,'거절 결과 확인 후 최신 자료로 새 검토').onclick();assert.equal(s.storage.size,0);}else assert.equal(btn(s,'거절 결과 확인 후 최신 자료로 새 검토'),undefined);
 }
});
test('confirmation and explicit checklist are sent with the audited access ID; ineligible source hides ready choice',async()=>{
 const s=setup();await open(s);await submit(s);assert.equal(s.calls.filter(c=>c.options?.method==='POST').length,0);assert.match(text(s.root),/저장을 확인/);
 field(s,'비공개 자료 열람 사유 (3~500자)').value='제출본 검토';await btn(s,'제출 원고 열람').onclick();fill(s);field(s,'검토 의견').value='READY_FOR_RESTORE_REVIEW';for(const label of ['권리 근거 직접 확인','등급·유해성 검토','AI 사용 고지 검토'])field(s,label).checked=true;await submit(s);
 const p=s.calls.find(c=>c.action==='recovery-decide').data;assert.equal(p.accessId,id);assert.equal(p.rightsChecked,true);assert.equal(p.ratingChecked,true);assert.equal(p.aiChecked,true);assert.equal(p.revision,'0');
 const x=setup({handler:c=>c.action==='recovery-list'?{requests:[request]}:{...detail,eligible:false,history:[{status:'HOLD',revision:'1',reason:'보완 필요'}]}});await open(x);assert.equal(btn(x,'제출 원고 열람'),undefined);assert.match(text(x.root),/변경되었습니다/);assert.match(text(x.root),/보완 필요/);
});
test('list/detail failures retry and pagination and late list responses obey current context',async()=>{
 let fail=true;const s=setup({handler:c=>{if(fail)throw Error('READ_FAILED');return c.action==='recovery-list'?{requests:[],hasMore:true}:detail;}});await s.render();assert.match(text(s.root),/조회 실패/);fail=false;await btn(s,'다시 불러오기').onclick();assert.match(text(s.root),/요청이 없습니다/);await btn(s,'다음').onclick();assert.ok(s.calls.at(-1).url.includes('offset=50'));await btn(s,'이전').onclick();assert.ok(s.calls.at(-1).url.includes('offset=0'));
 let detailFail=true;const x=setup({handler:c=>c.action==='recovery-list'?{requests:[request]}:detailFail?Promise.reject(Error('DETAIL_FAILED')):detail});await open(x);assert.match(text(x.root),/DETAIL_FAILED/);detailFail=false;await btn(x,'다시 확인').onclick();assert.match(text(x.root),/원고 복구 검토/);
 const d=deferred(),late=setup({handler:()=>d.promise});const work=late.render();late.c.AdminRecovery.reset();d.resolve({requests:[request]});await work;assert.equal(late.root.children.length,0);
});
test('source failed retry is exact and account-scoped storage does not expose other account pending requests',async()=>{
 let fail=true;const s=setup({handler:c=>c.action==='recovery-list'?{requests:[request]}:c.action==='recovery-detail'?detail:fail?Promise.reject(Error('NETWORK')):{accessId:id,content:'PRIVATE_SUBMITTED_BODY'}});await open(s);field(s,'비공개 자료 열람 사유 (3~500자)').value='자료 검토';await btn(s,'제출 원고 열람').onclick();const first=s.calls.at(-1).options.body;
 assert.equal(s.storage.size,1);assert.ok(!JSON.stringify([...s.storage]).includes('PRIVATE_SUBMITTED_BODY'));fail=false;await btn(s,'동일 요청 결과 확인').onclick();assert.equal(s.calls.filter(c=>c.action==='recovery-source')[1].options.body,first);assert.match(text(s.root),/PRIVATE_SUBMITTED_BODY/);
 const other=setup({storage:new Map([['webnovels:recovery-review:other:'+id,JSON.stringify({action:'recovery-decide',data:{recoveryId:id}})]])});await open(other);assert.equal(btn(other,'동일 요청 결과 확인'),undefined);
});
test('loader, menu, auth reset and router leave hooks preserve the existing administrator route and script order',()=>{
 const role=readFileSync('public/js/core/role-modules.js','utf8');assert.ok(role.indexOf('admin-recovery.js')<role.indexOf('admin-operations.js'));
 const ops=readFileSync('public/js/admin/admin-operations.js','utf8');assert.match(ops,/\['recovery','원고 복구 검토'/);assert.match(ops,/AdminRecovery\.render/);assert.equal((ops.match(/AdminRecovery\?\.reset\(\)/g)||[]).length,2);
 assert.match(readFileSync('public/js/core/router.js','utf8'),/AdminRecovery\?\.leave\(viewId\)/);assert.match(readFileSync('public/js/core/auth-session.js','utf8'),/AdminOperations\?\.reset\(\)/);
});
