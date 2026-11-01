import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {adminMembersApi} from '../server/admin-members-api.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',reader='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333';
const authorAdmin='44444444-4444-4444-8444-444444444444',readerAdmin='55555555-5555-4555-8555-555555555555',readOnly='66666666-6666-4666-8666-666666666666';
const opsAdmin='77777777-7777-4777-8777-777777777777',reviewAdmin='88888888-8888-4888-8888-888888888888',supportAdmin='99999999-9999-4999-8999-999999999999';
const readerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db,legacyDb,sql;
const rows=async(text,args=[],target=db)=>(await target.query(text,args)).rows;
const call=async(action,data,user=admin,target=db)=>(await rows('select public.admin_member_directory($1,$2,$3) result',[user,action,data],target))[0].result;
const list=(kind,extra={},user=admin)=>call('list',{kind,...extra},user);
const detail=(kind,accountId,user=admin)=>call('detail',{kind,accountId},user);
async function setup(legacy=false){
 const target=await PGlite.create();
 await target.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema authoring;
  alter default privileges in schema public revoke all on tables from public,anon,authenticated,service_role;
  alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{"secret":"AUTH_METADATA_PRIVATE"}');
  insert into auth.users(id,email,last_sign_in_at) values('${owner}','owner@example.test',now()),('${reader}','reader@example.test',now()-interval '60 days'),('${admin}','admin@example.test',now()),('${authorAdmin}','author-admin@example.test',now()),('${readerAdmin}','reader-admin@example.test',now()),('${readOnly}','read-only@example.test',now());
  create table public.authors(id bigint primary key,auth_user_id uuid,username text,pen_name text,bio text,profile_image text,status text,created_at timestamptz,private_field text default 'AUTHOR_PRIVATE');
  insert into public.authors(id,auth_user_id,username,pen_name,bio,profile_image,status,created_at) select i,case when i=1 then '${owner}'::uuid else null end,'author'||i,'작가 '||i,'소개 '||i,'','APPROVED',now()-make_interval(days=>i) from generate_series(1,55) i;
  update public.authors set pen_name='정확%_작가' where id=10;update public.authors set pen_name='정확한작가' where id=11;update public.authors set status='SUSPENDED' where id=54;
  create table public.readers(id ${legacy?'bigint':'uuid'} primary key,auth_user_id uuid,username text,nickname text,status text,is_adult_verified boolean default false,adult_verified_at timestamptz,points integer default 99999,created_at timestamptz);
  insert into public.readers(id,auth_user_id,username,nickname,status,created_at) values(${legacy?'7':`'${readerId}'`},'${reader}','reader','같은 필명','ACTIVE',now()-interval '5 days');
  create table public.admin_users(id uuid primary key,auth_user_id uuid,username text,nickname text,role text,is_active boolean,permissions text[]);
  insert into public.admin_users values('${admin}','${admin}','admin','Admin','SUPER_ADMIN',true,'{}'),('${authorAdmin}','${authorAdmin}','author-admin','Author admin','SUB_ADMIN',true,array['CREATOR_MGMT']),('${readerAdmin}','${readerAdmin}','reader-admin','Reader admin','SUB_ADMIN',true,array['USER_MGMT']),('${readOnly}','${readOnly}','readonly','Reader','SUB_ADMIN',true,array['ACCOUNTS_READ']);
  insert into auth.users(id,email) values('${opsAdmin}','ops@example.test'),('${reviewAdmin}','review@example.test'),('${supportAdmin}','support@example.test');
  insert into public.admin_users values('${opsAdmin}','${opsAdmin}','ops','Operations reader','SUB_ADMIN',true,array['ACCOUNTS_READ','OPERATIONS_READ']),('${reviewAdmin}','${reviewAdmin}','review','Content reviewer','SUB_ADMIN',true,array['ACCOUNTS_READ','CONTENT_REVIEW']),('${supportAdmin}','${supportAdmin}','support','Support reader','SUB_ADMIN',true,array['ACCOUNTS_READ','CASE_READ']);
  create table authoring.migrations(version text primary key);
  create table public.works(id bigint primary key,author_id bigint,title text,type text,status text,secret_manuscript text);
  insert into public.works values(101,1,'첫 작품','WEBNOVEL','COMPLETED','MANUSCRIPT_PRIVATE'),(102,1,'두번째 웹툰','WEBTOON','ONGOING','MANUSCRIPT_PRIVATE'),(103,1,'보관 작품','WEBNOVEL','ONGOING','MANUSCRIPT_PRIVATE');
  create table authoring.work_state(work_id bigint primary key,serial_state text,trashed_at timestamptz);
  insert into authoring.work_state values(101,'COMPLETED',null),(102,'HIATUS',null),(103,'ONGOING',now());
  create table public.episodes(id bigint primary key,work_id bigint);insert into public.episodes values(1001,101),(1002,101);
  create table authoring.publication_heads(episode_id bigint,published_at timestamptz);insert into authoring.publication_heads values(1001,now()-interval '2 days'),(1002,now()-interval '1 day');
  create table authoring.reader_progress(user_id uuid,work_id bigint,episode_id bigint,last_read_at timestamptz);insert into authoring.reader_progress values('${reader}',101,1001,now()-interval '1 day');
  create table authoring.support_cases(id uuid primary key default gen_random_uuid(),owner_id uuid,title text,status text,created_at timestamptz default now());
  insert into authoring.support_cases(owner_id,title,status) values('${owner}','작가 문의','OPEN'),('${reader}','독자 문의','WAITING_USER');
  create table authoring.publication_changes(id uuid primary key default gen_random_uuid(),user_id uuid,work_id bigint,kind text,created_at timestamptz default now(),candidate jsonb);
  create table authoring.publication_change_decisions(change_id uuid primary key,decision text);
  insert into authoring.publication_changes(user_id,work_id,kind,candidate) values('${owner}',101,'EPISODE_EDIT','{"content":"CHANGE_BODY_PRIVATE"}');`);
 await target.exec(await read('database/launch/004_virtual_accounts.sql'));
 await target.exec(`update launch_recovery.account_service set enabled=true;
  insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values('author','1','${owner}','synthetic','test',repeat('a',64)),('reader','${legacy?'7':readerId}','${reader}','synthetic','test',repeat('a',64));
  insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) select 'admin',id::text,auth_user_id,'synthetic','test',repeat('a',64) from public.admin_users;
  insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values('author','1','${owner}','owner@example.test');
  create table launch_recovery.author_payout_details(author_id bigint primary key,verification_status text,account_holder text,account_envelope jsonb,last4 text);
  insert into launch_recovery.author_payout_details values(1,'PENDING','LEGAL_NAME_PRIVATE','{"ciphertext":"BANK_PRIVATE"}','4321');
  create table launch_recovery.author_settlement_applications(author_id bigint primary key,status text,profile_envelope jsonb,identity_envelope jsonb);
  insert into launch_recovery.author_settlement_applications values(1,'APPROVED','{"address":"ADDRESS_PRIVATE"}','{"id":"IDENTITY_PRIVATE"}');
  create schema commerce;create table commerce.orders(id uuid,mode text check(mode='TEST'),status text,amount numeric);
  insert into commerce.orders values(gen_random_uuid(),'TEST','PAID',1000000);
  set webnovels.admin_members_apply_verified='true';`);
 await target.exec(sql);return target;
}
before(async()=>{sql=await read('database/launch/017_admin_members.sql');db=await setup();});
after(async()=>{await db?.close();await legacyDb?.close();});

test('migration preserves all existing profiles and mappings; replay is additive and ACLs are explicit',async()=>{
 const before=(await rows('select (select count(*) from authors)::int authors,(select count(*) from readers)::int readers,(select count(*) from launch_recovery.account_links)::int links'))[0];
 await db.exec(sql);
 assert.deepEqual((await rows('select (select count(*) from authors)::int authors,(select count(*) from readers)::int readers,(select count(*) from launch_recovery.account_links)::int links'))[0],before);
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(rows('select * from launch_recovery.member_profile_revisions'),error=>error.code==='42501');
   await assert.rejects(rows('select * from launch_recovery.member_profile_receipts'),error=>error.code==='42501');
   await assert.rejects(rows("select launch_recovery.member_directory_meta('author','{}','{}',true,true,true,true)"),error=>error.code==='42501');
   if(role==='service_role')assert.equal((await list('author')).kind,'author');
   else await assert.rejects(list('author'),error=>error.code==='42501');
  }finally{await db.exec('reset role');}
 }
});

test('author and reader pages are separate, stably paginated beyond fifty, with independent kind permissions',async()=>{
 const first=await list('author');assert.equal(first.items.length,50);assert.equal(first.total,55);assert.equal(first.nextOffset,50);assert.equal(first.hasMore,true);
 const last=await list('author',{offset:50});assert.equal(last.items.length,5);assert.equal(last.hasMore,false);assert.equal(last.nextOffset,null);
 assert.equal(new Set([...first.items,...last.items].map(item=>item.id)).size,55);
 const readers=await list('reader');assert.equal(readers.total,1);assert.deepEqual(readers.items.map(item=>item.id),[readerId]);
 assert.equal((await list('reader',{},authorAdmin)).error,'ADMIN_FORBIDDEN');assert.equal((await list('author',{},readerAdmin)).error,'ADMIN_FORBIDDEN');
 assert.equal((await list('author',{},authorAdmin)).items.length,50);assert.equal((await list('reader',{},readerAdmin)).total,1);
 assert.equal((await list('author',{},owner)).error,'ADMIN_FORBIDDEN');
});

test('literal search handles wildcards and exact mapped email without exposing Auth data',async()=>{
 assert.deepEqual((await list('author',{q:'정확%_'})).items.map(item=>item.id),['10']);
 assert.equal((await list('author',{q:"' OR 1=1 --"})).total,0);
 assert.deepEqual((await list('author',{q:'owner@example.test'})).items.map(item=>item.id),['1']);
 assert.equal((await list('author',{q:'owner@example.test'},authorAdmin)).error,'EMAIL_SEARCH_FORBIDDEN');
 const limited=(await list('author',{q:'작가 1'},authorAdmin)).items[0];assert.equal(limited.maskedEmail,null);
 const result=await detail('author','1');assert.match(result.member.maskedEmail,/\*/);assert.equal(result.member.authLinked,true);
 assert.doesNotMatch(JSON.stringify(result),/owner@example\.test|AUTH_METADATA_PRIVATE|AUTHOR_PRIVATE|MANUSCRIPT_PRIVATE|BANK_PRIVATE|LEGAL_NAME_PRIVATE|ADDRESS_PRIVATE|IDENTITY_PRIVATE|CHANGE_BODY_PRIVATE/);
 assert.ok(!JSON.stringify(result).includes(owner),'Auth UUID is not a profile identifier');
 assert.equal((await detail('reader',reader)).error,'ACCOUNT_NOT_FOUND');assert.equal((await detail('author',owner)).error,'INVALID_ACCOUNT_ID');
});

test('status, linkage, date, activity, works, settlement and pending filters use confirmed metadata',async()=>{
 assert.deepEqual((await list('author',{status:'SUSPENDED'})).items.map(item=>item.id),['54']);
 assert.equal((await list('author',{linked:'LINKED'})).total,1);assert.equal((await list('author',{linked:'UNLINKED'})).total,54);
 assert.deepEqual((await list('author',{hasWorks:'YES'})).items.map(item=>item.id),['1']);assert.equal((await list('author',{hasWorks:'NO'})).total,54);
 assert.deepEqual((await list('author',{settlement:'REGISTERED'})).items.map(item=>item.id),['1']);
 assert.deepEqual((await list('author',{settlement:'APPROVED'})).items.map(item=>item.id),['1']);
 assert.equal((await list('author',{settlement:'REGISTERED'},authorAdmin)).error,'FILTER_NOT_AVAILABLE');
 assert.equal((await list('reader',{hasWorks:'YES'})).error,'FILTER_NOT_AVAILABLE');
 assert.deepEqual((await list('author',{pending:'YES'})).items.map(item=>item.id),['1']);
 // Date inputs are KST calendar days, independent of the runner's UTC day.
 // Isolate exact midnight boundaries, including the preceding UTC date.
 await db.exec('begin');
 try{
  await rows("update public.authors set created_at='2026-10-30T00:00:00Z'::timestamptz");
  await rows(`update public.authors set created_at=case id
   when 1 then '2026-11-01T14:59:59.999999Z'::timestamptz
   when 2 then '2026-11-01T15:00:00Z'::timestamptz
   when 3 then '2026-11-02T14:59:59.999999Z'::timestamptz
   when 4 then '2026-11-02T15:00:00Z'::timestamptz end where id between 1 and 4`);
  const from=await list('author',{createdFrom:'2026-11-02'});assert.equal(from.total,3);assert.deepEqual(from.items.map(item=>item.id),['4','3','2']);
  const to=await list('author',{createdTo:'2026-11-02'});assert.equal(to.total,54);assert.ok(!to.items.some(item=>item.id==='4'));
  const day=await list('author',{createdFrom:'2026-11-02',createdTo:'2026-11-02'});assert.equal(day.total,2);assert.deepEqual(day.items.map(item=>item.id),['3','2']);
  assert.deepEqual((await list('author',{createdFrom:'2026-11-01',createdTo:'2026-11-01'})).items.map(item=>item.id),['1']);
  assert.deepEqual((await list('author',{createdFrom:'2026-11-03',createdTo:'2026-11-03'})).items.map(item=>item.id),['4']);
 }finally{await db.exec('rollback');}
 assert.equal((await list('reader',{activity:'7D'})).total,1,'reader progress is recent even when login is older');
 assert.equal((await list('author',{createdFrom:'2026-02-31'})).error,'INVALID_QUERY');
 assert.equal((await list('author',{createdFrom:'2026-11-10',createdTo:'2026-11-01'})).error,'INVALID_QUERY');
 assert.equal((await list('author',{offset:100001})).error,'INVALID_QUERY');
});

test('detail joins safe work and request summaries; TEST payments and legacy points remain unaggregated',async()=>{
 const author=await detail('author','1');assert.equal(author.works.length,2);assert.equal(author.member.workCount,2);
 assert.equal(author.works.find(item=>item.id==='102').status,'HIATUS');assert.ok(author.works.every(item=>item.id!=='103'));
 assert.equal(author.works.find(item=>item.id==='101').episodeCount,2);assert.ok(author.member.lastPublishedAt);
 assert.equal(author.member.pendingRequests,2);assert.equal(author.requests.length,2);
 assert.equal(author.settlement.bankRegistered,true);assert.equal(author.settlement.applicationStatus,'APPROVED');assert.equal(author.settlement.verification,'MANUAL_REVIEW_NOT_PASS_OR_BANK');
 const rd=await detail('reader',readerId);assert.equal(rd.works.length,0);assert.equal(rd.requests.length,1);assert.equal(rd.settlement.state,'NOT_APPLICABLE');
 assert.deepEqual(rd.finance,{state:'NOT_CONNECTED',paidTotal:null,netPaidTotal:null,paidPoints:null,bonusPoints:null,latestPayment:null});
 assert.equal(rd.capabilities.filters.payments,false);assert.equal(rd.capabilities.filters.balance,false);assert.equal(rd.capabilities.filters.orderSearch,false);
 assert.equal(rd.capabilities.sources.rights,false);assert.deepEqual(rd.rights,[]);
 const limited=await detail('author','1',authorAdmin);assert.equal(limited.settlement.state,'NO_ACCESS');assert.equal(limited.settlement.bankRegistered,null);assert.equal(limited.member.pendingRequests,null);assert.deepEqual(limited.history,[]);
});

test('support and publication metadata each require their original independent permissions',async()=>{
 const ops=await detail('author','1',opsAdmin);assert.equal(ops.member.pendingRequests,null);assert.deepEqual(ops.requests,[]);assert.equal(ops.capabilities.sources.support,false);assert.equal(ops.capabilities.sources.publicationChanges,false);
 assert.equal((await list('author',{pending:'YES'},opsAdmin)).error,'FILTER_NOT_AVAILABLE');
 const reviewer=await detail('author','1',reviewAdmin);assert.equal(reviewer.member.pendingRequests,1);assert.deepEqual(reviewer.requests.map(item=>item.kind),['PUBLICATION_CHANGE']);assert.equal(reviewer.capabilities.sources.support,false);assert.equal(reviewer.capabilities.sources.publicationChanges,true);assert.doesNotMatch(JSON.stringify(reviewer),/작가 문의/);
 const readerView=await detail('reader',readerId,reviewAdmin);assert.equal(readerView.member.pendingRequests,null);assert.deepEqual(readerView.requests,[]);assert.equal(readerView.capabilities.filters.requests,false);
 const support=await detail('author','1',supportAdmin);assert.equal(support.member.pendingRequests,1);assert.deepEqual(support.requests.map(item=>item.kind),['SUPPORT']);assert.equal(support.capabilities.sources.publicationChanges,false);assert.equal(support.capabilities.sources.support,true);
});

test('SUPER-only public profile edits are audited, exact-revision and idempotent without altering sensitive state',async()=>{
 const before=await detail('author','1');
 const data={kind:'author',accountId:'1',revision:before.member.revision,displayName:'새 필명',bio:'공개 소개',reason:'작가 요청에 따른 수정',requestId:crypto.randomUUID()};
 assert.equal((await call('update-profile',data,readOnly)).error,'ADMIN_FORBIDDEN');
 assert.equal((await call('update-profile',{...data,status:'APPROVED'})).error,'INVALID_PROFILE');
 const privateBefore=(await rows("select to_jsonb(a)-array['pen_name','bio'] profile from authors a where id=1"))[0].profile;
 const authBefore=(await rows('select to_jsonb(u) value from auth.users u where id=$1',[owner]))[0].value;
 const bankBefore=(await rows('select to_jsonb(x) value from launch_recovery.author_payout_details x where author_id=1'))[0].value;
 const saved=await call('update-profile',data);assert.equal(saved.saved,true);assert.equal(saved.member.displayName,'새 필명');assert.notEqual(saved.member.revision,before.member.revision);
 assert.deepEqual(await call('update-profile',data),saved);
 assert.equal((await call('update-profile',{...data,displayName:'다른 필명'})).error,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call('update-profile',{...data,requestId:crypto.randomUUID()})).error,'PROFILE_CONFLICT');
 assert.deepEqual((await rows("select to_jsonb(a)-array['pen_name','bio'] profile from authors a where id=1"))[0].profile,privateBefore);
 assert.deepEqual((await rows('select to_jsonb(u) value from auth.users u where id=$1',[owner]))[0].value,authBefore);
 assert.deepEqual((await rows('select to_jsonb(x) value from launch_recovery.author_payout_details x where author_id=1'))[0].value,bankBefore);
 const after=await detail('author','1');assert.equal(after.history.length,1);assert.deepEqual(after.history[0].after,{displayName:'새 필명',bio:'공개 소개'});
 assert.doesNotMatch(JSON.stringify(after.history),/auth_user_id|account_holder|account_envelope|status|private_field/);
 assert.equal(Number((await rows('select count(*) n from launch_recovery.member_profile_receipts'))[0].n),1);
});

test('self-service changes and ABA transitions invalidate old author and reader revisions',async()=>{
 const authorBefore=await detail('author','1');
 await rows('update authors set pen_name=$1 where id=1',['임시 변경']);await rows('update authors set pen_name=$1 where id=1',[authorBefore.member.displayName]);
 const authorAfter=await detail('author','1');assert.notEqual(authorAfter.member.revision,authorBefore.member.revision);
 assert.equal((await call('update-profile',{kind:'author',accountId:'1',revision:authorBefore.member.revision,displayName:'오래된 입력',bio:'',reason:'오래된 화면 저장',requestId:crypto.randomUUID()})).error,'PROFILE_CONFLICT');
 const readerBefore=await detail('reader',readerId);await rows('update readers set nickname=$1 where id=$2',['잠시 변경',readerId]);await rows('update readers set nickname=$1 where id=$2',[readerBefore.member.displayName,readerId]);
 const rd=await detail('reader',readerId);assert.notEqual(rd.member.revision,readerBefore.member.revision);
 const input={kind:'reader',accountId:readerId,revision:rd.member.revision,displayName:'새 독자명',reason:'독자 요청 수정',requestId:crypto.randomUUID()};
 assert.equal((await call('update-profile',{...input,bio:''})).error,'INVALID_PROFILE');
 const saved=await call('update-profile',input);assert.equal(saved.member.displayName,'새 독자명');assert.equal(saved.member.id,readerId);
 assert.equal((await rows('select points from readers where id=$1',[readerId]))[0].points,99999);
 await rows('update admin_users set is_active=false where auth_user_id=$1',[admin]);
 assert.equal((await call('update-profile',input)).error,'ACCOUNT_INACTIVE','revocation is checked before replay');
 await rows('update admin_users set is_active=true where auth_user_id=$1',[admin]);
});

test('missing optional sources are unknown and unavailable filters fail explicitly',async()=>{
 await db.exec('begin;drop table authoring.support_cases;drop table authoring.publication_change_decisions;drop table authoring.publication_changes;drop table launch_recovery.author_payout_details;drop table launch_recovery.author_settlement_applications;');
 try{
  const author=await detail('author','1');assert.equal(author.member.pendingRequests,null);assert.equal(author.member.settlementState,null);assert.equal(author.settlement.state,'NOT_CONNECTED');assert.equal(author.capabilities.sources.support,false);
  assert.equal((await list('author',{pending:'YES'})).error,'FILTER_NOT_AVAILABLE');assert.equal((await list('author',{settlement:'REGISTERED'})).error,'FILTER_NOT_AVAILABLE');
 }finally{await db.exec('rollback');}
});

test('status and Auth mapping changes invalidate snapshots; deleting and recreating a profile never reuses its revision',async()=>{
 await db.exec('begin');
 try{
  const initial=await detail('author','5');
  const stale={kind:'author',accountId:'5',revision:initial.member.revision,displayName:'옛 화면 저장',bio:'',reason:'이전 화면에서 수정',requestId:crypto.randomUUID()};
  await rows("update authors set status='SUSPENDED' where id=5");assert.equal((await call('update-profile',stale)).error,'PROFILE_CONFLICT');
  await rows("update authors set status='APPROVED',auth_user_id=$1 where id=5",[reader]);assert.equal((await call('update-profile',stale)).error,'PROFILE_CONFLICT');
  const before=await detail('author','55');const old=(await rows('select * from authors where id=55'))[0];
  await rows('delete from authors where id=55');
  await rows('insert into authors(id,auth_user_id,username,pen_name,bio,profile_image,status,created_at,private_field) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(old));
  const after=await detail('author','55');assert.notEqual(after.member.revision,before.member.revision);
 }finally{await db.exec('rollback');}
});

test('bounded profile writes preserve exact retry results and reject reused request IDs or excess writes',async()=>{
 await db.exec('begin');
 try{
  const before=await detail('author','9');const input={kind:'author',accountId:'9',revision:before.member.revision,displayName:'요청 한도 점검',bio:'공개 한도 검증',reason:'테스트 요청 한도 확인',requestId:crypto.randomUUID()};
  const saved=await call('update-profile',input);assert.equal(saved.saved,true);
  assert.equal((await call('update-profile',{...input,accountId:'10'})).error,'IDEMPOTENCY_CONFLICT');
  await rows("insert into launch_recovery.member_profile_receipts(actor_id,request_id,fingerprint,result) select $1,gen_random_uuid(),repeat('b',64),'{}' from generate_series(1,30)",[admin]);
  assert.deepEqual(await call('update-profile',input),saved,'a verified same request can be reconciled at the rate limit');
  const next={...input,revision:saved.member.revision,requestId:crypto.randomUUID(),displayName:'한도 초과 수정'};
  assert.equal((await call('update-profile',next)).error,'RATE_LIMITED');
  assert.equal((await detail('author','9')).member.displayName,'요청 한도 점검');
 }finally{await db.exec('rollback');}
});

test('legacy numeric reader IDs work without conflating Auth UUIDs or author IDs',async()=>{
 legacyDb=await setup(true);
 const result=await call('detail',{kind:'reader',accountId:'7'},admin,legacyDb);assert.equal(result.member.id,'7');assert.equal(result.kind,'reader');
 assert.equal((await call('detail',{kind:'reader',accountId:reader},admin,legacyDb)).error,'ACCOUNT_NOT_FOUND');
 assert.equal((await call('detail',{kind:'author',accountId:'7'},admin,legacyDb)).member.id,'7');
 assert.equal((await call('list',{kind:'reader',q:'같은 필명'},admin,legacyDb)).total,1);
});

test('actual directory RPC results pass API projection for paginated authors, both reader ID forms and public updates',async()=>{
 const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
 const invoke=async(action,body,target=db)=>{
  const actor=(await rows('select public.launch_account_actor($1) actor',[admin],target))[0].actor;
  const request=new Request('https://app.test/api/v2/admin/members?action='+action,{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(body)});
  return adminMembersApi({request,user:{id:admin},actor,fail,rpc:async(name,args)=>{
   assert.equal(name,'admin_member_directory');assert.equal(args.p_user,admin);
   const result=(await rows('select public.admin_member_directory($1,$2,$3) result',[args.p_user,args.p_action,args.p_data],target))[0].result;
   if(result.error)fail(result.status,result.error);return result;
  }});
 };
 const authorPage=await invoke('list',{kind:'author',q:'',offset:0});
 assert.equal(authorPage.kind,'author');assert.equal(authorPage.items.length,50);assert.equal(authorPage.total,55);assert.equal(authorPage.nextOffset,50);
 assert.equal(authorPage.capabilities.canEditPublic,true);assert.equal(authorPage.capabilities.canSearchEmail,true);assert.equal(authorPage.capabilities.canReadSettlement,true);
 assert.ok(authorPage.items.every(item=>/^\d+$/.test(item.id)&&typeof item.revision==='string'));
 assert.match(authorPage.items.find(item=>item.id==='1').maskedEmail,/\*/);
 const uuidReader=await invoke('detail',{kind:'reader',accountId:readerId});
 const numericReader=await invoke('detail',{kind:'reader',accountId:'7'},legacyDb);
 assert.equal(uuidReader.member.id,readerId);assert.equal(numericReader.member.id,'7');
 for(const result of [uuidReader,numericReader]){
  assert.equal(result.kind,'reader');assert.equal(result.capabilities.canReadSettlement,false);assert.equal(result.capabilities.sources.publicationChanges,false);
  assert.equal(result.finance.state,'NOT_CONNECTED');assert.equal(result.finance.paidTotal,null);assert.equal(result.finance.paidPoints,null);
  assert.ok(!Object.hasOwn(result.member,'bio'));assert.deepEqual(result.works,[]);
 }
 const before=await invoke('detail',{kind:'author',accountId:'12'});
 const input={kind:'author',accountId:'12',revision:before.member.revision,displayName:'API 연결 작가',bio:'실제 RPC와 응답 계약 검증',reason:'관리자 공개 정보 수정 확인',requestId:crypto.randomUUID()};
 const saved=await invoke('update-profile',input);assert.equal(saved.saved,true);assert.equal(saved.kind,'author');assert.equal(saved.member.id,'12');
 assert.equal(saved.member.displayName,'API 연결 작가');assert.notEqual(saved.member.revision,before.member.revision);
 assert.deepEqual(await invoke('update-profile',input),saved,'a successful DB receipt also survives API projection on retry');
 const after=await invoke('detail',{kind:'author',accountId:'12'});assert.equal(after.member.revision,saved.member.revision);assert.equal(after.history[0].after.displayName,'API 연결 작가');
 assert.doesNotMatch(JSON.stringify({authorPage,uuidReader,numericReader,saved,after}),/owner@example\.test|reader@example\.test|AUTH_METADATA_PRIVATE|AUTHOR_PRIVATE|MANUSCRIPT_PRIVATE|BANK_PRIVATE|LEGAL_NAME_PRIVATE|ADDRESS_PRIVATE|IDENTITY_PRIVATE|CHANGE_BODY_PRIVATE/);
 assert.ok(!JSON.stringify({authorPage,saved,after}).includes(owner),'API projection keeps authenticated user IDs out of profile responses');
});
