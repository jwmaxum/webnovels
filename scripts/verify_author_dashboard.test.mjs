import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {accountApi} from '../server/account-api.mjs';
import {encryptAccount} from '../server/author-dashboard-api.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const author='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',reader='33333333-3333-4333-8333-333333333333';

test('dashboard SQL isolates owners, preserves legacy data, coordinates profile revisions and masks private accounts',async()=>{
 const db=await PGlite.create();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema authoring;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
    insert into auth.users(id,email) values('${author}','a@example.test'),('${other}','b@example.test'),('${reader}','r@example.test');
    create table authors(id bigint primary key,auth_user_id uuid,username text,pen_name text,bio text,profile_image text,status text);
    insert into authors values(1,'${author}','author1','Author one','','','APPROVED'),(2,'${other}','author2','Author two','','','APPROVED');
    create table readers(id bigint,auth_user_id uuid,username text,nickname text,status text,is_adult_verified boolean,adult_verified_at timestamptz,points integer);
    insert into readers values(1,'${reader}','reader','Reader','ACTIVE',false,null,0);
    create table admin_users(id uuid,auth_user_id uuid,username text,nickname text,role text,is_active boolean,permissions text[]);
    create table works(id bigint primary key,author_id bigint,title text);insert into works values(1,1,'Own title'),(2,2,'Other title');
    create table episodes(id bigint,work_id bigint);insert into episodes values(1,1),(2,2);
    create table authoring.work_state(work_id bigint,author_id bigint,trashed_at timestamptz,updated_at timestamptz,visibility text);
    insert into authoring.work_state values(1,1,null,now(),'PRIVATE'),(2,2,null,now(),'PRIVATE');
    create table authoring.drafts(work_id bigint,author_id bigint,lifecycle text);insert into authoring.drafts values(1,1,'ACTIVE');
    create table author_earnings(id uuid default gen_random_uuid(),author_id bigint,work_id bigint,period_date date,author_revenue numeric,status text);
    insert into author_earnings(author_id,work_id,period_date,author_revenue,status) values(1,1,'2026-09-01',100,'ESTIMATED'),(2,2,'2026-08-01',200,'CONFIRMED'),(1,2,'2026-07-01',999,'PAID');
    create table author_settlement_accounts(author_id bigint,account_number_encrypted text);insert into author_settlement_accounts values(1,'legacy-keep');`);
  await db.exec(read('database/launch/004_virtual_accounts.sql'));
  await db.exec(`update launch_recovery.account_service set enabled=true;
    insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values
    ('author','1','${author}','test','test',repeat('a',64)),('author','2','${other}','test','test',repeat('a',64)),('reader','1','${reader}','test','test',repeat('a',64));
    insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values('author','1','${author}','a@example.test');
    create function public.launch_author_workspace_ready() returns boolean language sql as $$select public.launch_accounts_ready()$$;
    set webnovels.dashboard_apply_verified='true';`);
  const sql=read('database/launch/009_author_dashboard.sql');await db.exec(sql);await db.exec(sql);
  const call=async(action,data={},user=author)=>(await db.query('select launch_author_dashboard($1,$2,$3) value',[user,action,data])).rows[0].value;
  assert.equal((await call('home')).counts.works,1);assert.equal((await call('home')).estimatedRevenue,null);
  const earnings=await call('earnings');assert.equal(earnings.total,1);assert.equal(earnings.records[0].workTitle,'Own title');assert.deepEqual(earnings.months,['2026-09']);
  assert.equal((await call('earnings',{month:'2026-08'})).total,0);assert.equal((await call('earnings',{month:'2026-99'})).status,400);
  assert.equal((await call('profile',{},reader)).status,403);
  const profile=await call('profile');assert.equal(profile.bank,null);assert.equal(profile.legacyBankExists,true);
  assert.equal((await call('save-profile',{version:profile.profile.version,penName:'Changed',bio:'<script>plain text</script>'})).profile.penName,'Changed');
  assert.equal((await call('save-profile',{version:profile.profile.version,penName:'Stale',bio:''})).status,409);
  assert.equal((await db.query('select revision from launch_recovery.virtual_accounts')).rows[0].revision,2);
  assert.equal((await call('profile',{},other)).profile.penName,'Author two');
  const details={revision:'0',bankName:'Test Bank',holder:'Test Person',last4:'5678',envelope:await encryptAccount('12345678','test-secret',author+':1')};
  const bank=await call('save-bank',details);assert.equal(bank.bank.maskedNumber,'**** 5678');assert.equal(bank.bank.verificationStatus,'PENDING');
  assert.doesNotMatch(JSON.stringify(bank),/12345678|ciphertext|account_envelope/);
  assert.equal((await call('save-bank',details)).status,409);assert.equal((await call('profile',{},other)).bank,null);
  for(let i=0;i<5;i++)assert.equal((await call('bank-attempt')).ok,true);
  assert.equal((await call('bank-attempt')).status,429);
  assert.equal((await db.query('select account_number_encrypted from author_settlement_accounts')).rows[0].account_number_encrypted,'legacy-keep');
  assert.equal((await db.query(`select has_function_privilege('authenticated','launch_author_dashboard(uuid,text,jsonb)','execute') allowed`)).rows[0].allowed,false);
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from launch_recovery.author_payout_details'),/permission denied/);await db.exec('reset role');
  await assert.rejects(db.exec('delete from launch_recovery.author_dashboard_audit'),/immutable/);
  await db.exec("update authors set status='SUSPENDED' where id=1");assert.equal((await call('profile')).status,403);
 }finally{await db.close();}
});

test('dashboard HTTP validates owner, request origin, password reauthentication and sends only encrypted account data to SQL',async()=>{
 let who={userId:author,author:{id:'1',status:'APPROVED'}},passwordOK=true,calls=[],signedOut=0;
 const invoke=(action,body,origin='https://app.test')=>accountApi(new Request('https://app.test/api/v2/creator/dashboard?action='+action,{method:body?'POST':'GET',headers:{Authorization:'Bearer abc.def.ghi',Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'},{fetchImpl:async(url,opts)=>{
  const route=new URL(url).pathname;
  if(route.endsWith('_ready'))return Response.json(true);
  if(route==='/auth/v1/user')return Response.json({id:who.userId,email:'verified@example.test',email_confirmed_at:'2026-09-26'});
  if(route.endsWith('launch_account_actor'))return Response.json(who);
  if(route==='/auth/v1/token'){assert.equal(JSON.parse(opts.body).email,'verified@example.test');return passwordOK?Response.json({user:{id:author},access_token:'check-session'}):Response.json({}, {status:400});}
  if(route==='/auth/v1/logout'){assert.equal(new URL(url).searchParams.get('scope'),'local');signedOut++;return new Response(null,{status:204});}
  const body=JSON.parse(opts.body);calls.push(body);return Response.json({ok:true});
 }});
 assert.equal((await invoke('profile')).status,200);assert.equal(calls.at(-1).p_user,author);
 assert.equal((await invoke('profile&authorId=2')).status,400);
 const fields={revision:'0',bankName:'Test Bank',holder:'Test Person',accountNumber:'1234-5678-9012',password:'temporary-test'};
 assert.equal((await invoke('save-bank',fields,'https://evil.test')).status,403);
 assert.equal((await invoke('save-bank',{...fields,authorId:'2'})).status,400);
 passwordOK=false;assert.equal((await invoke('save-bank',fields)).status,403);assert.equal(calls.at(-1).p_action,'bank-attempt');
 passwordOK=true;assert.equal((await invoke('save-bank',fields)).status,200);assert.equal(signedOut,1);
 const saved=calls.at(-1);assert.equal(saved.p_action,'save-bank');assert.equal(saved.p_data.last4,'9012');assert.doesNotMatch(JSON.stringify(saved),/1234-5678|123456789012|temporary-test|password/);
 who={userId:reader,reader:{id:'1'}};assert.equal((await invoke('profile')).status,403);
 who={userId:reader,admin:{role:'SUPER_ADMIN',is_active:true}};assert.equal((await invoke('home')).status,403);
});

test('bank envelope decrypts only with the correct secret and owner binding, uses fresh nonces',async()=>{
 const secret='test-only-key',owner=author+':1',number='123456789012';const a=await encryptAccount(number,secret,owner),b=await encryptAccount(number,secret,owner);
 assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
 const decode=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0)),enc=new TextEncoder();
 const decrypt=async identity=>{
  const material=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('webnovels-bank-v1'),info:enc.encode(identity)},material,{name:'AES-GCM',length:256},false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(a.iv),additionalData:enc.encode(identity)},key,decode(a.ciphertext)));
 };
 assert.equal(await decrypt(owner),number);await assert.rejects(decrypt(other+':2'));
});

test('dashboard clears private forms on reset and suppresses late account responses; four navigation menus only',async()=>{
 let who={userId:author,author:{status:'APPROVED'},authorWorkspaceReady:true},resolve;
 const nodes=Object.fromEntries(['creatorHomeContent','creatorEarningsContent','creatorProfileContent'].map(id=>[id,{innerHTML:'',replaceChildren(){this.innerHTML='';}}]));
 const c={document:{getElementById:id=>nodes[id]},WebNovelsAuth:{getActor:()=>who,api:()=>new Promise(r=>resolve=r)}};c.window=c;vm.createContext(c);vm.runInContext(read('public/js/creator/creator-dashboard.js'),c);
 const pending=c.CreatorDashboard.profile();c.CreatorDashboard.reset();who={reader:{}};resolve({profile:{email:'private@example.test'}});await pending;
 assert.equal(nodes.creatorProfileContent.innerHTML,'');assert.equal(c.CreatorDashboard.active(),false);
 const html=read('public/index.html'),nav=html.split('id="creatorTabsBar"')[1].split('</div>')[0];
 assert.deepEqual([...nav.matchAll(/data-creator-tab="([^"]+)"/g)].map(m=>m[1]),['home','works','earnings','profile']);
 assert.ok(html.indexOf('creator-dashboard.js')<html.indexOf('creator.js?'));
 assert.match(read('public/js/core/auth-session.js'),/CreatorDashboard\?\.reset/);
 assert.match(read('public/js/core/router.js'),/CreatorDashboard\?\.reset/);
 assert.match(read('public/styles.css'),/#view-creator:not\(\.stage8-creator\):not\(\.private-author-workspace\) #creatorTabsBar/);
});

test('author entry from the reader home opens the dashboard; deep routes defer to the router',async()=>{
 const calls=[],c={location:{pathname:'/home'},document:{getElementById:()=>null},
   WebNovelsAuth:{getActor:()=>({author:{pen_name:'Writer'}})},CreatorDashboard:{active:()=>true}};
 c.window=c;vm.createContext(c);vm.runInContext(read('public/js/creator/creator.js'),c);
 c.switchCreatorTab=(...args)=>calls.push(args);
 await c.fetchCreatorDashboardData();assert.equal(calls.at(-1)[0],'home');
 c.location.pathname='/creator/profile';await c.fetchCreatorDashboardData();assert.equal(calls.at(-1)[0],'profile');
 const count=calls.length;await c.fetchCreatorDashboardData({loadContent:false});assert.equal(calls.length,count);
});
