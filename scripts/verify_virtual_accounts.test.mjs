import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {accountApi} from '../server/account-api.mjs';
const sql=fs.readFileSync(new URL('../database/launch/004_virtual_accounts.sql',import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',author='22222222-2222-4222-8222-222222222222',reader='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const db=await PGlite.create();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
 create table authors(id int primary key,auth_user_id uuid unique,username text,pen_name text,bio text,profile_image text,status text);
 create table readers(id int primary key,auth_user_id uuid unique,username text,nickname text,status text,is_adult_verified boolean,adult_verified_at timestamptz,points int);
 create table admin_users(id uuid primary key,auth_user_id uuid unique,username text,nickname text,role text,is_active boolean,permissions text[]);
 create table works(id int primary key,author_id int references authors,title text);
 insert into auth.users(id,email_confirmed_at) values('${admin}',now()),('${author}',now()),('${reader}',now());
 insert into authors values(1,'${author}','writer1','Writer One','Original',null,'APPROVED');
 insert into readers values(1,'${reader}','reader1','Reader One','ACTIVE',false,null,0);
 insert into admin_users values('${admin}','${admin}','owner','Owner','SUPER_ADMIN',true,'{}');
 insert into works values(1,1,'Retained Work');`);
 await db.exec(sql);
 await db.exec(`insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256)
 values('author','1','${author}','explicit owner request','operator',repeat('a',64)),('reader','1','${reader}','explicit owner request','operator',repeat('a',64)),('admin','${admin}','${admin}','explicit owner request','operator',repeat('a',64));
 insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values('author','1','${author}','writer1@webnovels.com'),('reader','1','${reader}','reader1@webnovels.com');
 update launch_recovery.account_service set enabled=true;`);
 return db;
}
async function rpc(db,who,action,data={}){return (await db.query('select manage_virtual_account($1,$2,$3) value',[who,action,data])).rows[0].value;}
test('DB authorizes admin only, preserves integer profile IDs, rejects secret fields and stale revisions',async()=>{
 const db=await fixture();try{
   assert.equal((await rpc(db,author,'list')).error,'ADMIN_FORBIDDEN');
   const list=await rpc(db,admin,'list');assert.equal(list.accounts.length,2);assert.equal(list.accounts[0].id,'1');
   const p={kind:'author',id:'1',revision:'1',reason:'Operator profile edit',displayName:'Updated Writer',bio:'Updated bio'};
   assert.equal((await rpc(db,admin,'update',{...p,auth_user_id:admin})).error,'INVALID_ACCOUNT_REQUEST');
   const result=await rpc(db,admin,'update',p);assert.equal(result.account.displayName,'Updated Writer');assert.equal(result.account.revision,'2');
   assert.equal((await rpc(db,admin,'update',p)).error,'CONFLICT');
   const actor=(await db.query('select launch_account_actor($1) value',[author])).rows[0].value;
   assert.equal(actor.author.id,'1');assert.equal(actor.admin,null);assert.equal(actor.author.pen_name,'Updated Writer');
   await db.exec('update authors set status=null');
   assert.equal((await db.query('select launch_account_actor($1) value',[author])).rows[0].value.error,'ACCOUNT_INACTIVE');
   await db.exec(`update admin_users set is_active=false`);assert.equal((await rpc(db,admin,'list')).error,'ACCOUNT_INACTIVE');
 }finally{await db.close();}
});
test('logical deletion blocks existing sessions, preserves manuscripts and requires Auth sync before next edit',async()=>{
 const db=await fixture();try{
   let result=await rpc(db,admin,'delete',{kind:'author',id:'1',revision:'1',reason:'Remove virtual account'});
   assert.ok(result.account.deletedAt);assert.equal(result.account.authSyncPending,true);assert.equal(result.ban,true);
   assert.equal((await db.query('select launch_account_actor($1) value',[author])).rows[0].value.error,'ACCOUNT_INACTIVE');
   assert.equal((await db.query('select count(*) from works')).rows[0].count,1);
   assert.equal((await rpc(db,admin,'restore',{kind:'author',id:'1',revision:'2',reason:'Restore account'})).error,'AUTH_SYNC_REQUIRED');
   await rpc(db,admin,'sync-complete',{kind:'author',id:'1',revision:'2'});
   result=await rpc(db,admin,'restore',{kind:'author',id:'1',revision:'2',reason:'Restore account'});
   assert.equal(result.account.deletedAt,null);assert.equal(result.account.status,'APPROVED');assert.equal(result.ban,false);
   assert.equal((await rpc(db,admin,'audit')).events.length,2);
   await assert.rejects(db.exec('delete from launch_recovery.account_audit'),/immutable/);
   await assert.rejects(db.exec('delete from launch_recovery.account_links'),/immutable/);
 }finally{await db.close();}
});
test('browser roles cannot invoke account RPCs or change mappings; exposed private fields close readiness',async()=>{
 const db=await fixture();try{
   await db.exec('set role authenticated');
   await assert.rejects(db.query('select launch_account_actor($1)',[author]),/permission denied/);
   await assert.rejects(db.exec('select * from launch_recovery.virtual_accounts'),/permission denied/);
   await db.exec('reset role');
   assert.equal((await db.query('select launch_accounts_ready() ready')).rows[0].ready,true);
   await db.exec('grant select(auth_user_id) on authors to anon');
   assert.equal((await db.query('select launch_accounts_ready() ready')).rows[0].ready,false);
 }finally{await db.close();}
});
const token='eyJtest.eyJtest.signature';
async function invoke(path,{method='GET',data,origin='https://example.test',identity=admin,ready=true,syncStatus=200,headers={},env={}}={}){
 const calls=[];
 const request=new Request('https://example.test'+path,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
 const response=await accountApi(request,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',...env},{fetchImpl:async(url,options)=>{
   const route=new URL(url).pathname;calls.push({route,options});
   if(route.endsWith('launch_accounts_ready'))return Response.json(ready);
   if(route==='/auth/v1/user')return Response.json({id:identity,email_confirmed_at:'2026-09-25'});
   if(route.endsWith('launch_account_actor'))return Response.json({userId:identity,admin:identity===admin?{role:'SUPER_ADMIN',is_active:true}:null,author:identity===author?{id:'1'}:null});
   if(route.endsWith('manage_virtual_account')){const body=JSON.parse(options.body);
     if(body.p_action==='sync-complete')return Response.json({account:{revision:'2',authSyncPending:false}});
     if(body.p_action==='delete')return Response.json({account:{revision:'2',authSyncPending:true},authUserId:author,ban:true});
     return Response.json({accounts:[]});}
   if(route==='/auth/v1/admin/users/'+author)return Response.json({}, {status:syncStatus});
   throw Error('UNEXPECTED_ROUTE');
 }});
 return {response,calls};
}
test('account rollout validates real Auth and DB readiness while content routes remain outside scope',async()=>{
 let r=await invoke('/api/v2/me');assert.equal(r.response.status,200);assert.equal((await r.response.json()).accountServiceOnly,true);
 assert.equal((await invoke('/api/v2/me',{ready:false})).response.status,503);
 assert.equal((await invoke('/api/v2/admin/virtual-accounts',{identity:author})).response.status,403);
 assert.equal((await invoke('/api/v2/creator/works')).response,null);
 assert.equal((await invoke('/api/v2/me',{env:{P0_API_ENABLED:'true'}})).response,null);
 assert.equal((await invoke('/api/v2/accounts/health',{env:{ACCOUNT_API_DISABLED:'true'}})).response.status,503);
});
test('admin mutations reject foreign origins and privilege fields, and retryable ban failure keeps account disabled',async()=>{
 const data={kind:'author',id:'1',revision:'1',reason:'Remove virtual account'};
 assert.equal((await invoke('/api/v2/admin/virtual-accounts?action=delete',{method:'POST',data,origin:'https://evil.test'})).response.status,403);
 assert.equal((await invoke('/api/v2/admin/virtual-accounts?action=delete',{method:'POST',data:{...data,authUserId:admin}})).response.status,400);
 assert.equal((await invoke('/api/v2/admin/virtual-accounts?action=sync-complete',{method:'POST',data})).response.status,400);
 let r=await invoke('/api/v2/admin/virtual-accounts?action=delete',{method:'POST',data});assert.equal(r.response.status,200);
 assert.equal(r.calls.find(c=>c.route==='/auth/v1/admin/users/'+author).options.body,JSON.stringify({ban_duration:'876000h'}));
 assert.ok(!JSON.stringify(await r.response.json()).includes(author));
 r=await invoke('/api/v2/admin/virtual-accounts?action=delete',{method:'POST',data,syncStatus:500});
 assert.equal(r.response.status,503);assert.equal((await r.response.json()).error,'AUTH_SYNC_REQUIRED');
 assert.equal(r.calls.filter(c=>c.options.body?.includes('sync-complete')).length,0);
});

test('virtual account UI uses text nodes, preserves target/revision, and never loads for a writer',async()=>{
 class Node{
   constructor(tag){this.tag=tag;this.children=[];this.value='';this.textContent='';}
   append(n){this.children.push(n);} replaceChildren(){this.children=[];} setAttribute(){} focus(){}
   querySelectorAll(tag){return this.children.flatMap(c=>[...(c.tag===tag?[c]:[]),...c.querySelectorAll(tag)]);}
 }
 let who={userId:admin,admin:{role:'SUPER_ADMIN'}},calls=[];
 const account={kind:'author',id:'1',email:'writer1@webnovels.com',revision:'4',displayName:'<img onerror=evil()>',bio:'Bio',status:'APPROVED',works:1};
 const context={document:{createElement:t=>new Node(t)},confirm:()=>true,WebNovelsAuth:{getActor:()=>who,message:e=>e.message,
   api:async(url,options)=>{calls.push({url,options});return options?{account}:{accounts:[account]};}}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../public/js/admin/virtual-accounts.js',import.meta.url),'utf8'),context);
 const root=new Node('main');await context.VirtualAccounts.render(root);
 assert.ok(root.querySelectorAll('h4').some(n=>n.textContent===account.displayName));assert.equal(root.querySelectorAll('img').length,0);
 const form=root.querySelectorAll('form')[0];const inputs=form.querySelectorAll('input');inputs[0].value='New name';inputs[1].value='Operator profile correction';
 await form.onsubmit({preventDefault(){}});
 const save=calls.find(c=>c.options);assert.ok(save);assert.deepEqual(JSON.parse(save.options.body),{
   kind:'author',id:'1',revision:'4',reason:'Operator profile correction',displayName:'New name',bio:'Bio'});
 who={userId:author,author:{id:'1'}};calls=[];await context.VirtualAccounts.render(root);assert.equal(calls.length,0);
});
