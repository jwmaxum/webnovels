import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {accountApi} from '../server/account-api.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',sub='22222222-2222-4222-8222-222222222222',writer='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const db=await PGlite.create();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
 create table authors(id int primary key,auth_user_id uuid unique,username text,pen_name text,bio text,profile_image text,status text);
 create table readers(id int primary key,auth_user_id uuid unique,username text,nickname text,status text,is_adult_verified boolean,adult_verified_at timestamptz,points int);
 create table admin_users(id uuid primary key,auth_user_id uuid unique,username text,nickname text,role text,is_active boolean,permissions jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
 create table works(id int primary key,author_id int references authors,title text,status text,content_type text,rating text,is_top_recommended boolean,is_popular_work boolean,is_new_work boolean);
 create table episodes(id int primary key,work_id int references works,episode_number int,title text,status text,is_free boolean,content text);
 create table content_reviews(id uuid primary key,work_title text,status text,created_at timestamptz);
 create table reports(id uuid primary key,target_type text,target_id text,status text,created_at timestamptz);
 create table author_settlements(id uuid primary key,author_id int,amount numeric,status text,requested_at timestamptz,processed_at timestamptz,bank_info text);
 insert into auth.users(id,email_confirmed_at) values('${admin}',now()),('${sub}',now()),('${writer}',now());
 insert into admin_users(id,auth_user_id,username,nickname,role,is_active,permissions) values
 ('${admin}','${admin}','admin','Owner','SUPER_ADMIN',true,'[]'),('${sub}','${sub}','staff','Staff','SUB_ADMIN',true,'["OPERATIONS_READ","LEGACY_UNKNOWN"]');
 insert into authors values(1,'${writer}','writer','Writer','Original',null,'APPROVED');
 insert into works values(1,1,'<img onerror=evil()>','PUBLISHED','NOVEL','ALL',false,false,false);
 insert into episodes values(1,1,1,'Original','PUBLISHED',true,'PRIVATE MANUSCRIPT'),(2,1,2,'Empty','PUBLISHED',true,'');
 insert into author_settlements values('${sub}',1,10000,'PAID',now(),now(),'PRIVATE BANK');`);
 await db.exec(read('database/launch/004_virtual_accounts.sql'));
 await db.exec(`insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values
 ('admin','${admin}','${admin}','fixture','test',repeat('a',64)),('admin','${sub}','${sub}','fixture','test',repeat('a',64)),('author','1','${writer}','fixture','test',repeat('a',64));
 update launch_recovery.account_service set enabled=true;`);
 await db.exec(read('database/launch/005_admin_console.sql'));
 await db.exec(read('database/launch/006_work_curation.sql'));return db;
}
async function rpc(db,who,action,data={}){return (await db.query('select launch_admin_console($1,$2,$3) value',[who,action,data])).rows[0].value;}
test('curation changes only three flags, preserves rows, requires permission and revision, and records durable audit',async()=>{
 const db=await fixture();try{
   const original=(await db.query('select * from works where id=1')).rows[0];
   const flags={is_top_recommended:true,is_popular_work:true,is_new_work:false};
   const data={workId:'1',revision:'0',flags,reason:'Homepage editorial selection'};
   for(const user of [writer,sub])assert.equal((await rpc(db,user,'curation-update',data)).status,403);
   for(const invalid of [{...data,status:'PUBLISHED'},{...data,flags:{...flags,is_new_work:'true'}},{...data,flags:{...flags,author_id:2}},{...data,reason:''}])
     assert.equal((await rpc(db,admin,'curation-update',invalid)).status,400);
   const saved=await rpc(db,admin,'curation-update',data);assert.equal(saved.saved,true);assert.equal(saved.work.curation_revision,'1');
   const after=(await db.query('select * from works where id=1')).rows[0];assert.deepEqual(after,{...original,...flags});
   assert.equal((await db.query('select content from episodes where id=1')).rows[0].content,'PRIVATE MANUSCRIPT');
   assert.equal((await rpc(db,admin,'works')).items[0].curation_revision,'1');
   assert.equal((await rpc(db,admin,'curation-update',data)).status,409);
   assert.equal((await rpc(db,admin,'curation-update',{...data,revision:'1'})).changed,false);
   assert.equal((await rpc(db,admin,'audit')).items[0].action,'curation-update');
   await assert.rejects(db.exec('delete from launch_recovery.work_curation_audit'),/immutable/);
   await db.exec(`update admin_users set permissions='["CURATION_WRITE"]' where id='${sub}'`);
   assert.equal((await rpc(db,sub,'works')).total,1);
   const next=await rpc(db,sub,'curation-update',{...data,revision:'1',flags:{...flags,is_top_recommended:false}});assert.equal(next.work.curation_revision,'2');
   // Other authorized SQL/legacy writers also advance the revision, including A->B->A changes.
   await db.exec('update works set is_new_work=true where id=1;update works set is_new_work=false where id=1');
   assert.equal((await rpc(db,sub,'curation-update',{...data,revision:'2'})).status,409);
   await db.exec(read('database/launch/006_work_curation.sql'));
   assert.equal((await rpc(db,admin,'works')).items[0].curation_revision,'4');
 }finally{await db.close();}
});
test('console inventory is server authorized and excludes manuscripts, accounts and financial secrets',async()=>{
 const db=await fixture();try{
   const dashboard=await rpc(db,admin,'dashboard');assert.equal(dashboard.works,1);assert.equal(dashboard.episodes,2);assert.equal(dashboard.emptyOriginals,1);
   for(const action of ['dashboard','works','episodes','roles','settlements','audit'])assert.equal((await rpc(db,writer,action)).status,403);
   assert.equal((await rpc(db,sub,'dashboard')).works,1);
   for(const action of ['works','episodes','roles','settlements','audit'])assert.equal((await rpc(db,sub,action)).status,403);
   const episodes=await rpc(db,admin,'episodes');assert.equal(episodes.total,2);assert.doesNotMatch(JSON.stringify(episodes),/PRIVATE MANUSCRIPT/);
   assert.equal((await rpc(db,admin,'works',{q:'missing'})).total,0);
   assert.equal((await rpc(db,admin,'works',{offset:100})).items.length,0);
   const money=await rpc(db,admin,'settlements');assert.equal(money.items[0].recorded_amount,'10000');assert.doesNotMatch(JSON.stringify(money),/PRIVATE BANK|bank_info|password|auth_user/);
   for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select launch_admin_console($1,'roles')",[admin]),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});
test('role changes preserve legacy permissions, reject privilege escalation/conflicts, and apply to existing sessions',async()=>{
 const db=await fixture();try{
   const before=await rpc(db,admin,'roles'),target=before.items.find(x=>x.id===sub);
   const data={adminId:sub,revision:target.revision,permissions:['CONTENT_METADATA_READ'],reason:'Assign CMS duty'};
   assert.equal((await rpc(db,sub,'role-update',data)).status,403);
   assert.equal((await rpc(db,admin,'role-update',{...data,permissions:['SUPER_ADMIN']})).status,400);
   assert.equal((await rpc(db,admin,'role-update',{...data,role:'SUPER_ADMIN'})).status,400);
   assert.equal((await rpc(db,admin,'role-update',{...data,adminId:admin})).status,403);
   assert.equal((await rpc(db,admin,'role-update',data)).saved,true);
   assert.equal((await rpc(db,admin,'role-update',data)).status,409);
   assert.equal((await rpc(db,sub,'dashboard')).status,403);
   assert.equal((await rpc(db,sub,'works')).items.length,1);
   const row=(await db.query('select * from admin_users where id=$1',[sub])).rows[0];
   assert.deepEqual(row.permissions,['CONTENT_METADATA_READ','LEGACY_UNKNOWN']);assert.equal(row.role,'SUB_ADMIN');assert.equal(row.auth_user_id,sub);
   assert.equal((await rpc(db,admin,'audit')).total,1);
   await assert.rejects(db.exec('delete from launch_recovery.admin_permission_audit'),/immutable/);
   assert.equal((await db.query('select content from episodes where id=1')).rows[0].content,'PRIVATE MANUSCRIPT');
 }finally{await db.close();}
});
async function invoke({action='roles',method='GET',identity=admin,origin='https://example.test',body,reauthId=admin,loginStatus=200}={}){
 const calls=[];const response=await accountApi(new Request('https://example.test/api/v2/admin/console?action='+action,{
   method,headers:{Authorization:'Bearer eyJtest.eyJtest.signature','Content-Type':'application/json',Origin:origin},...(body?{body:JSON.stringify(body)}:{})
 }),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'},{fetchImpl:async(url,opt)=>{
   const path=new URL(url).pathname;calls.push({path,body:opt.body,headers:opt.headers});
   if(path.endsWith('launch_accounts_ready'))return Response.json(true);
   if(path==='/auth/v1/user')return Response.json({id:identity,email:'verified@example.test',email_confirmed_at:'2026-09-25'});
   if(path.endsWith('launch_account_actor'))return Response.json({userId:identity,admin:identity===writer?null:{role:identity===admin?'SUPER_ADMIN':'SUB_ADMIN',is_active:true}});
   if(path==='/auth/v1/token')return Response.json({user:{id:reauthId},access_token:'temporary-verification-token'},{status:loginStatus});
   if(path==='/auth/v1/logout')return new Response(null,{status:204});
   if(path.endsWith('launch_admin_console'))return Response.json({saved:true,items:[]});
   throw Error('UNEXPECTED_ROUTE');
 }});return {response,calls};
}
test('API requires owner password reauthentication and origin, and sends only safe fields to the RPC',async()=>{
 const body={adminId:sub,revision:'a'.repeat(32),permissions:['ACCOUNTS_READ'],reason:'Assign support duty',password:'test-only-password'};
 const request={action:'role-update',method:'POST',body};
 for(const change of [{identity:writer},{identity:sub},{origin:'https://evil.test'},{reauthId:sub},{loginStatus:400}]){
   const r=await invoke({...request,...change});assert.equal(r.response.status,403);assert.ok(!r.calls.some(x=>x.path.endsWith('launch_admin_console')));
 }
 assert.equal((await invoke({...request,body:{...body,authUserId:admin}})).response.status,400);
 const result=await invoke(request);assert.equal(result.response.status,200);
 assert.equal(JSON.parse(result.calls.find(x=>x.path==='/auth/v1/token').body).email,'verified@example.test');
 assert.ok(result.calls.some(x=>x.path==='/auth/v1/logout'));
 const forwarded=result.calls.find(x=>x.path.endsWith('launch_admin_console'));assert.doesNotMatch(forwarded.body,/password|temporary-verification/);
 assert.equal(JSON.parse(forwarded.body).p_user,admin);
});
test('curation API rejects forged owners, cross-origin and malformed flags without invoking a write RPC',async()=>{
 const body={workId:'1',revision:'0',flags:{is_top_recommended:true,is_popular_work:false,is_new_work:true},reason:'Change home selection'};
 const req={action:'curation-update',method:'POST',body};
 for(const change of [{identity:writer},{identity:sub},{origin:'https://evil.test'},{body:{...body,author_id:1}},{body:{...body,flags:{...body.flags,is_new_work:'true'}}}]){
   const r=await invoke({...req,...change});assert.ok([400,403].includes(r.response.status));assert.ok(!r.calls.some(x=>x.path.endsWith('launch_admin_console')));
 }
 const saved=await invoke(req);assert.equal(saved.response.status,200);assert.ok(!saved.calls.some(x=>x.path==='/auth/v1/token'));
 assert.equal(JSON.parse(saved.calls.find(x=>x.path.endsWith('launch_admin_console')).body).p_action,'curation-update');
});
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';this.attributes={};this.classList={add(){}};}
 append(n){this.children.push(n);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);}
}
test('account-only admin sees CMS, settlement and role menus, old deep links work, and session changes clear the console',async()=>{
 const nodes=Object.fromEntries(['adminOperationsContent','adminOperationsShell','adminOperationsNav','view-admin-cms','adminConsoleIdentity'].map(id=>[id,new Node('div')]));
 let who={userId:admin,admin:{role:'SUPER_ADMIN',nickname:'Owner'},accountServiceReady:true},calls=[];
 const context={URLSearchParams,document:{getElementById:id=>nodes[id],createElement:t=>new Node(t)},WEBNOVELS_CONFIG:{adminOperationsEnabled:false},
   WebNovelsAuth:{getActor:()=>who,api:async url=>{calls.push(url);return url.includes('dashboard')?{works:30,episodes:180}: {items:[],total:0};}},
   location:{pathname:'/admin/'},history:{pushState(){}},VirtualAccounts:{reset(){},render(){assert.fail('must not replace the dashboard');}}};
 context.window=context;vm.createContext(context);vm.runInContext(read('public/js/admin/admin-console.js'),context);vm.runInContext(read('public/js/admin/admin-operations.js'),context);
 await context.AdminOperations.navigate('dashboard',false);
 const labels=nodes.adminOperationsNav.querySelectorAll('button').map(n=>n.textContent);
 for(const label of ['운영 대시보드','작품 CMS','회차 CMS','작가 정산','서브관리자·권한','가상 계정 관리'])assert.ok(labels.includes(label),label);
 assert.match(calls[0],/console\?action=dashboard/);
 for(const [path,action] of [['subadmins','roles'],['settlements','settlements'],['episodes','episodes'],['authors','accounts']]){
   await context.AdminOperations.navigate(path,false);assert.match(calls.at(-1),new RegExp('action='+action));
 }
 assert.ok(!calls.some(x=>x.includes('/operations')));
 who={userId:sub,admin:{role:'SUB_ADMIN',permissions:['CONTENT_METADATA_READ']},accountServiceReady:true};
 await context.AdminOperations.navigate('dashboard',false);
 assert.deepEqual(nodes.adminOperationsNav.querySelectorAll('button').map(n=>n.textContent),['작품 CMS','회차 CMS']);
 context.AdminOperations.reset();assert.equal(nodes.adminOperationsNav.children.length,0);assert.equal(nodes.adminOperationsContent.children.length,0);
});
test('CMS treats database content as text and discards a response after navigation',async()=>{
 const root=new Node('div');let resolve;const who={userId:admin,admin:{role:'SUPER_ADMIN'}};
 const context={URLSearchParams,document:{createElement:t=>new Node(t)},WebNovelsAuth:{getActor:()=>who,api:()=>new Promise(r=>{resolve=r;})}};
 context.window=context;vm.createContext(context);vm.runInContext(read('public/js/admin/admin-console.js'),context);
 const first=context.AdminConsole.render(root,'works');context.AdminConsole.reset();await context.AdminConsole.render(root,'settings');
 resolve({items:[{id:'1',title:'<img onerror=evil()>'}],total:1});await first;
 assert.equal(root.querySelectorAll('h2')[0].textContent,'서비스 운영 설정');assert.equal(root.querySelectorAll('img').length,0);
 context.WebNovelsAuth.api=async()=>({items:[{id:'1',title:'<img onerror=evil()>'}],total:1});
 await context.AdminConsole.render(root,'works');assert.ok(root.querySelectorAll('td').some(n=>n.textContent.includes('<img onerror=evil()>')));assert.equal(root.querySelectorAll('img').length,0);
});
test('role form posts the selected target and revision, clears password input and refreshes after saving',async()=>{
 const root=new Node('div'),calls=[];
 const context={URLSearchParams,document:{createElement:t=>new Node(t)},WebNovelsAuth:{getActor:()=>({userId:admin,admin:{role:'SUPER_ADMIN'}}),
   api:async(url,options)=>{calls.push({url,options});return options?{saved:true}:{items:[{id:sub,nickname:'Staff',role:'SUB_ADMIN',permissions:['OPERATIONS_READ'],revision:'a'.repeat(32),is_active:true,linked:false}],total:1};}}};
 context.window=context;vm.createContext(context);vm.runInContext(read('public/js/admin/admin-console.js'),context);
 await context.AdminConsole.render(root,'roles');const form=root.querySelectorAll('form')[0],inputs=form.querySelectorAll('input');
 inputs.find(x=>x.type==='text').value='Assign CMS work';inputs.find(x=>x.type==='password').value='test-only-password';
 inputs.find(x=>x.value==='CONTENT_METADATA_READ').checked=true;
 await form.onsubmit({preventDefault(){}});
 const sent=JSON.parse(calls.find(x=>x.options).options.body);assert.equal(sent.adminId,sub);assert.equal(sent.revision,'a'.repeat(32));
 assert.deepEqual(sent.permissions,['OPERATIONS_READ','CONTENT_METADATA_READ']);assert.equal(inputs.find(x=>x.type==='password').value,'');
 assert.equal(calls.length,3);
});
test('curation UI supports edit/save/reset, preserves failed choices and locks stale edits without faking success',async()=>{
 const root=new Node('div'),calls=[];let failure=null,updated=null;
 const work={id:'1',title:'Work',curation_revision:'0',is_top_recommended:false,is_popular_work:true,is_new_work:false};
 const context={URLSearchParams,document:{createElement:t=>new Node(t)},WebNovelsAuth:{getActor:()=>({userId:admin,admin:{role:'SUPER_ADMIN'}}),
   api:async(url,options)=>{calls.push({url,options});if(options){if(failure)throw {code:failure};return {saved:true,work:{id:'1',curation_revision:'1',...JSON.parse(options.body).flags}};}return {items:[{...work}],total:1};}},applyHomeCuration:x=>{updated=x;}};
 context.window=context;vm.createContext(context);vm.runInContext(read('public/js/admin/admin-console.js'),context);
 await context.AdminConsole.render(root,'works');const form=root.querySelectorAll('form').find(n=>n.className==='cms-curation');
 const checks=form.querySelectorAll('input').filter(n=>n.type==='checkbox'),save=form.querySelectorAll('button').find(n=>n.textContent==='저장');
 assert.equal(save.disabled,true);checks[0].checked=true;checks[0].onchange();assert.equal(save.disabled,false);
 form.querySelectorAll('button').find(n=>n.textContent==='되돌리기').onclick();assert.equal(checks[0].checked,false);
 checks[0].checked=true;checks[0].onchange();failure='NETWORK';await form.onsubmit({preventDefault(){}});assert.equal(checks[0].checked,true);assert.equal(save.disabled,false);
 failure=null;await form.onsubmit({preventDefault(){}});assert.equal(save.disabled,true);assert.equal(updated.is_top_recommended,true);
 assert.equal(JSON.parse(calls.find(x=>x.options).options.body).revision,'0');
 checks[2].checked=true;checks[2].onchange();failure='CONFLICT';await form.onsubmit({preventDefault(){}});assert.equal(save.disabled,true);assert.equal(checks[2].disabled,true);
 assert.ok(form.querySelectorAll('p').some(n=>n.textContent.includes('다른 관리자')));
});
test('public home sections honor cleared flags and local refresh never adds private CMS works',async()=>{
 const source=read('public/js/reader/reader.js'),ast=ts.createSourceFile('reader.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='renderHomeWorks').getText(ast);
 const apply=ast.statements.find(n=>ts.isExpressionStatement(n)&&n.getText(ast).startsWith('window.applyHomeCuration =')).getText(ast);
 const nodes=Object.fromEntries(['trendingWorksGrid','newWorksGrid'].map(id=>[id,{innerHTML:''}]));
 const works=[{id:1,isTopRecommended:false,isPopularWork:false,isNewWork:false,episodes:[]}];
 const context={SAMPLE_WORKS:works,getPublishedWorks:()=>works,document:{getElementById:id=>nodes[id]},ReaderHub:{active:()=>true},
   renderCdgHeroSlider(){},renderCdgWorkCardHtml:()=>'<article>work</article>',renderGenreRecommendations(){},renderGoldenBest:async()=>{},console:{error(){}}};
 context.window=context;vm.createContext(context);vm.runInContext(fn+'\n'+apply,context);await context.renderHomeWorks();
 assert.ok(!nodes.trendingWorksGrid.innerHTML.includes('<article>'));assert.ok(!nodes.newWorksGrid.innerHTML.includes('<article>'));
 context.applyHomeCuration({id:'private',is_popular_work:true});assert.equal(works.length,1);
 context.applyHomeCuration({id:'1',is_popular_work:true,is_top_recommended:false,is_new_work:false});assert.equal(works[0].isPopularWork,true);
 assert.ok(nodes.trendingWorksGrid.innerHTML.includes('<article>'));
});
