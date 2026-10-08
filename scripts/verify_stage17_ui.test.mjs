import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
const file=new URL('../public/js/admin/admin-workflow.js',import.meta.url),source=readFileSync(file,'utf8');
const id='11111111-1111-4111-8111-111111111111';
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attributes={};this.value='';this.disabled=false;this.checked=false;this.classList={add(){}};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];this.textContent='';}
 setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
 set innerHTML(value){assert.fail('Untrusted HTML must never be used: '+value);}
}
const text=node=>node.textContent+' '+node.children.map(text).join(' ');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const caseItem={id,source:'CONTENT_REVIEW',label:'<script>untrusted</script>',status:'PENDING',target:'WORK:10',createdAt:'2026-10-09T00:00:00Z',
 workflow:{revision:'0',assigneeId:null,priority:'NORMAL',dueAt:null,evidence:'검토 근거',duplicateId:null}};
const read=(action)=>({cases:{cases:[caseItem]},assignees:{assignees:[]},appeals:{appeals:[]},accounts:{accounts:[{id,name:'독자',status:'ACTIVE'}]},
 'account-support':{linked:true,emailConfirmed:true,authBlocked:false,status:'ACTIVE'},'work-list':{works:[{id:'10',title:'작품',status:'PUBLISHED',version:'1',moderation:'CLEAR'}]},
 curation:{placements:[]},preview:{placements:[]},audit:{events:[],missingSources:[]}})[action]||{};
function setup({permission,handler,enabled=true}={}){
 const root=new Node('div'),calls=[];let who={userId:id,admin:{role:permission?'SUB_ADMIN':'SUPER_ADMIN',is_active:true,permissions:permission||[]}};
 const context={URLSearchParams,Date,crypto:webcrypto,document:{createElement:t=>new Node(t)},WEBNOVELS_CONFIG:{adminWorkflowEnabled:enabled,adminOperationsEnabled:true},
  WebNovelsAuth:{getActor:()=>who,api:async(url,options)=>{const action=new URL(url,'https://example.test').searchParams.get('action');const call={action,options,url};calls.push(call);return handler?handler(call):read(action);}}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:fileURLToPath(file)});
 return {root,calls,context,api:context.AdminWorkflow,setActor:value=>{who=value;}};
}
const findField=(form,label)=>form.querySelectorAll('input,select,textarea').find(x=>x.attributes['aria-label']===label);
const submit=form=>form.onsubmit({preventDefault(){}});
const reason=form=>{findField(form,'조치 사유 (3~500자)').value='자료 확인 완료';};
test('read-only cases render untrusted text, metadata and paging without mutation or private draft controls',async()=>{
 const t=setup({permission:['CASE_READ']});await t.api.render(t.root,'cases');
 assert.match(text(t.root),/<script>untrusted<\/script>/);assert.equal(t.root.querySelectorAll('form').length,0);
 assert.ok(t.calls.every(x=>!x.options));
 const disabled=setup({enabled:false});await disabled.api.render(disabled.root,'cases');assert.equal(disabled.calls.length,0);
});
test('lost response retries the frozen request UUID and payload once, disabling edits during uncertain outcome',async()=>{
 let attempts=0;
 const t=setup({handler:call=>{if(call.options){if(++attempts===1)throw Error('NETWORK_LOST');return {saved:true};}return read(call.action);}});
 await t.api.render(t.root,'cases');const form=t.root.querySelectorAll('form')[0];reason(form);
 await submit(form);const save=form.querySelectorAll('button')[0];assert.match(save.textContent,/같은 요청/);
 assert.ok(form.querySelectorAll('input,select,textarea').every(x=>x.disabled));
 findField(form,'검토 근거 (3~2000자)').value='DOM 조작으로 변경';await submit(form);
 const writes=t.calls.filter(x=>x.options);assert.equal(writes.length,2);assert.equal(writes[0].options.body,writes[1].options.body);
 assert.equal(JSON.parse(writes[0].options.body).assigneeId,null);assert.equal(JSON.parse(writes[0].options.body).revision,'0');
});
test('concurrent submit is suppressed; conflict keeps user input and offers an explicit refresh',async()=>{
 const pending=deferred();const t=setup({handler:call=>call.options?pending.promise:read(call.action)});await t.api.render(t.root,'cases');
 const form=t.root.querySelectorAll('form')[0];reason(form);const first=submit(form);await submit(form);assert.equal(t.calls.filter(x=>x.options).length,1);
 pending.reject(Object.assign(Error('CASE_CONFLICT'),{status:409,code:'CASE_CONFLICT'}));await first;
 assert.equal(findField(form,'조치 사유 (3~500자)').value,'자료 확인 완료');assert.match(text(form),/최신 상태 불러오기/);
});
test('late reads and mutations cannot repopulate a different account or navigation; reset clears manuscript',async()=>{
 const pending=deferred();const t=setup({handler:call=>call.action==='cases'?pending.promise:read(call.action)});
 const first=t.api.render(t.root,'cases');await t.api.render(t.root,'audit');pending.resolve(read('cases'));await first;assert.doesNotMatch(text(t.root),/untrusted/);
 const delayed=deferred();const u=setup({handler:call=>call.options?delayed.promise:read(call.action)});await u.api.render(u.root,'cases');
 const form=u.root.querySelectorAll('form')[0];reason(form);const save=submit(form);u.setActor({userId:'different',admin:{role:'SUPER_ADMIN'}});u.api.reset();delayed.resolve({saved:true});await save;assert.equal(u.root.children.length,0);
 const p=setup({handler:call=>call.options?{draft:{title:'PRIVATE TITLE',revision:'1',content:'PRIVATE BODY'}}:read(call.action)});await p.api.render(p.root,'cases');
 const draft=p.root.querySelectorAll('form').at(-1);reason(draft);findField(draft,'작가가 전달한 초안 UUID').value=id;await submit(draft);assert.match(text(p.root),/PRIVATE BODY/);p.api.reset();assert.equal(p.root.children.length,0);
});
test('appeal review and followup are separate forms; account support does not send recovery email',async()=>{
 const t=setup({handler:call=>call.action==='appeals'?{appeals:[{id,source:'WORK_MODERATION',sourceId:id,status:'ACCEPTED',reason:'이의 제기',targetVersion:'2'}]}:read(call.action)});
 await t.api.render(t.root,'appeals');const form=t.root.querySelectorAll('form')[0];reason(form);await submit(form);
 assert.equal(t.calls.find(x=>x.options).action,'appeal-followup');assert.equal(JSON.parse(t.calls.find(x=>x.options).options.body).decision,'MAINTAIN');
 const u=setup({permission:['ACCOUNTS_READ']});await u.api.render(u.root,'accounts');assert.equal(u.root.querySelectorAll('form').length,0);assert.match(text(u.root),/비밀번호 재설정/);
 await u.root.querySelectorAll('button').find(x=>x.textContent==='연결·복구 상태 확인').onclick();assert.match(text(u.root),/이메일 인증 확인/);assert.ok(u.calls.every(x=>!x.options));
});
test('curation preview uses server projection and its save carries UTC interval, slot and revision',async()=>{
 const t=setup({handler:call=>call.action==='preview'?{placements:[{slot:'HOME_SPOTLIGHT',position:1,work:{id:'10',title:'<img onerror=bad>'}}]}:call.options?{saved:true}:read(call.action)});
 await t.api.render(t.root,'curation');await t.root.querySelectorAll('button').find(x=>x.textContent==='미리보기').onclick();assert.match(text(t.root),/<img onerror=bad>/);assert.equal(t.root.querySelectorAll('a')[0].href,'/works/10');
 const form=t.root.querySelectorAll('form')[0];reason(form);await submit(form);const data=JSON.parse(t.calls.find(x=>x.options).options.body);
 assert.equal(data.revision,'0');assert.equal(data.slot,'HOME_RECOMMENDED');assert.match(data.startsAt,/Z$/);assert.ok(Date.parse(data.endsAt)>Date.parse(data.startsAt));assert.equal(data.workId,'10');
});
test('existing admin URLs route to workflow and keep settlement/role console; menus distinguish cases and test tools',async()=>{
 const t=setup();const nodes=Object.fromEntries(['adminOperationsContent','adminOperationsShell','adminOperationsNav','view-admin-cms','adminConsoleIdentity'].map(id=>[id,new Node('div')]));
 t.context.document.getElementById=id=>nodes[id];t.context.location={pathname:'/admin'};t.context.history={pushState(){}};
 const consoleCalls=[];t.context.AdminConsole={reset(){},render:async(root,page)=>consoleCalls.push(page)};t.context.VirtualAccounts={reset(){},render(){}};
 vm.runInContext(readFileSync(new URL('../public/js/admin/admin-operations.js',import.meta.url),'utf8'),t.context);
 for(const tab of ['review','comments','authors','works','curation','audit'])await t.context.AdminOperations.navigate(tab,false);
 assert.ok(t.calls.some(c=>c.url.includes('action=cases&source=COMMENT_REPORT')));assert.ok(t.calls.some(c=>c.url.includes('action=accounts&kind=author')));
 for(const tab of ['subadmins','settlements','episodes'])await t.context.AdminOperations.navigate(tab,false);
 assert.deepEqual(consoleCalls,['roles','settlements','episodes']);assert.match(text(nodes.adminOperationsNav),/사건 처리/);assert.match(text(nodes.adminOperationsNav),/가상 계정 시험 도구/);
 t.context.AdminOperations.reset();assert.equal(nodes.adminOperationsContent.children.length,0);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(html.indexOf('/js/admin/admin-workflow.js')<html.indexOf('/js/admin/admin-operations.js'));
});
