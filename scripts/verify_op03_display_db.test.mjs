import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {siteDisplayAdminApi,siteDisplayPublicApi} from '../server/site-display-api.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const admin='11111111-1111-4111-8111-111111111111',curator='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333',author='44444444-4444-4444-8444-444444444444';
let db,sql;
const rows=async(query,args=[])=>(await db.query(query,args)).rows;
const call=async(action,data={},user=admin)=>(await rows('select public.admin_site_display($1,$2,$3) result',[user,action,data]))[0].result;
const published=async(data={})=>(await rows('select public.site_display_public($1) result',[data]))[0].result;
const get=()=>call('get');
const uuid=()=>crypto.randomUUID();
const iso=offset=>new Date(Date.now()+offset).toISOString();
const select=(workId,home='NONE',extra={})=>({id:uuid(),workId:String(workId),home,startsAt:null,endsAt:null,enabled:true,caption:'관리자 선정',...extra});
const mutation=(extra={})=>({reason:'편집 운영자 검토 반영',requestId:uuid(),...extra});
async function save(document){const state=await get();return call('save',mutation({revision:state.draft.revision,document}));}
async function publish(document,extra={}){const saved=await save(document);assert.equal(saved.error,undefined);return call('publish',mutation({revision:saved.draft.revision,startsAt:iso(-60000),endsAt:null,...extra}));}
async function doc(){return structuredClone((await get()).draft.document);}

before(async()=>{
 db=await PGlite.create();sql=await read('database/launch/018_site_display.sql');
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema authoring;create schema launch_recovery;
  alter default privileges in schema public revoke all on tables from public,anon,authenticated,service_role;
  alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
  create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,banned_until timestamptz,deleted_at timestamptz);
  insert into auth.users(id) values('${admin}'),('${curator}'),('${viewer}'),('${author}');
  create table public.admin_users(id uuid primary key,auth_user_id uuid,role text,is_active boolean,permissions text[]);
  insert into public.admin_users values('${admin}','${admin}','SUPER_ADMIN',true,'{}'),('${curator}','${curator}','SUB_ADMIN',true,array['CURATION_WRITE']),('${viewer}','${viewer}','SUB_ADMIN',true,array['CONTENT_METADATA_READ']);
  create function public.launch_accounts_ready() returns boolean language sql stable security definer set search_path='' as 'select true';
  create function public.launch_account_actor(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
    select case when u.email_confirmed_at is null or u.is_anonymous or u.deleted_at is not null or u.banned_until>now() then '{"error":"ACCOUNT_REQUIRED","status":403}'::jsonb else
     jsonb_build_object('userId',u.id,'admin',(select jsonb_build_object('role',a.role,'is_active',a.is_active,'permissions',to_jsonb(a.permissions)) from public.admin_users a where a.auth_user_id=u.id)) end from auth.users u where u.id=p_user
  $$;
  create table public.authors(id bigint primary key,auth_user_id uuid,pen_name text,status text);
  insert into public.authors values(1,'${author}','현재 필명','APPROVED'),(2,'${author}','대기 작가','PENDING');
  create table public.works(id bigint primary key,author_id bigint,title text,type text,content_type text,status text,rating text,genre jsonb,description text,cover_image text,author text,
   is_top_recommended boolean default false,is_popular_work boolean default false,is_new_work boolean default false,eligible boolean default true,is_free boolean default true,published_at timestamptz default now(),body text default 'PRIVATE_MANUSCRIPT',manifest jsonb default '{"secret":"PRIVATE_MANIFEST"}');
  insert into public.works(id,author_id,title,type,status,rating,genre,description,cover_image,author)
   select i,1,'작품 '||i,case when i%2=0 then 'WEBTOON' else 'NOVEL' end,'PUBLISHED','ALL','["판타지"]','작품 소개','/cover.jpg','옛 스냅샷 필명' from generate_series(1,90) i;
  update public.works set is_top_recommended=true where id=1;update public.works set is_popular_work=true where id=2;update public.works set is_new_work=true where id=3;
  update public.works set title='정확%_작품' where id=10;update public.works set rating='ADULT' where id=85;update public.works set eligible=false where id=86;update public.works set published_at=now()+interval '1 day' where id=87;update public.works set is_free=false where id=89;update public.works set author_id=2 where id=90;
  update public.works set content_type='WEBTOON',type='NOVEL' where id=88;
  insert into public.works(id,author_id,title,type,status,rating,genre,description,author) values(9007199254740993,1,'큰 ID 작품','NOVEL','PUBLISHED','ALL','[]','설명','옛 필명');
  create table authoring.editorial_placements(id uuid primary key default gen_random_uuid(),work_id bigint,slot text,position int,starts_at timestamptz,ends_at timestamptz,enabled boolean);
  insert into authoring.editorial_placements(work_id,slot,position,starts_at,ends_at,enabled) values(4,'HOME_RECOMMENDED',1,now()-interval '1 day',now()+interval '1 day',true),(5,'HOME_SPOTLIGHT',2,now()-interval '2 day',now()+interval '2 day',false);
  insert into authoring.editorial_placements(work_id,slot,position,starts_at,ends_at,enabled) select 6,'HOME_SPOTLIGHT',1,now()-make_interval(days=>60-i),now()-make_interval(days=>59-i),false from generate_series(1,25) i;
  update public.works set is_top_recommended=true,is_popular_work=true,is_new_work=true where id=6;
  create table authoring.migrations(version text primary key);insert into authoring.migrations values('baseline');
  create function authoring.stage18_work_rows(p_asof timestamptz) returns table(work_id bigint,item jsonb,episode_count bigint,first_published_at timestamptz,last_published_at timestamptz,ranking_readers bigint)
  language sql stable security definer set search_path='' as $$
   select w.id,jsonb_build_object('id',w.id::text,'title',w.title,'author',w.author,'author_id',w.author_id::text,'content_type',coalesce(w.content_type,w.type),'status',w.status,'rating',w.rating,'genre',w.genre,'description',w.description,'cover_image',w.cover_image,'episode_count',1,'firstEpisodeNumber',1,'is_top_recommended',w.is_top_recommended,'is_popular_work',w.is_popular_work,'is_new_work',w.is_new_work),1::bigint,w.published_at,w.published_at,null::bigint
   from public.works w join public.authors a on a.id=w.author_id join auth.users u on u.id=a.auth_user_id where w.eligible and w.is_free and w.published_at<=p_asof and w.status in ('PUBLISHED','ONGOING','COMPLETED') and w.rating in ('ALL','AGE_15') and a.status='APPROVED' and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())
  $$;
  set webnovels.site_display_apply_verified='true';`);
 await db.exec("create function launch_recovery.account_audit_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'ACCOUNT_AUDIT_IMMUTABLE';end $$;");
 await db.exec(await read('database/launch/006_work_curation.sql'));
 await db.exec(sql);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec(`truncate launch_recovery.site_display_actions,launch_recovery.site_display_receipts,launch_recovery.site_display_audit,launch_recovery.site_display_releases;
  update launch_recovery.site_display_draft set document=launch_recovery.site_display_default(),revision=0,updated_by=null;
  update public.admin_users set is_active=true,permissions=case when id='${curator}' then array['CURATION_WRITE'] when id='${viewer}' then array['CONTENT_METADATA_READ'] else array[]::text[] end;
  update auth.users set banned_until=null,deleted_at=null,email_confirmed_at=now();update public.authors set pen_name='현재 필명',status=case when id=1 then 'APPROVED' else 'PENDING' end;
  update public.works set eligible=true where id not in (86);`);
});

test('migration is additive, repeatable, service-only and keeps private tables/helpers closed',async()=>{
 const check=await rows('select launch_recovery.site_display_document_valid(launch_recovery.site_display_default()) valid');
 assert.equal(check[0].valid,true,'default document validates');
 const original=(await rows('select count(*)::int n from works'))[0].n;
 await db.exec("set webnovels.site_display_apply_verified='false'");
 await assert.rejects(db.exec(sql),/Reviewed display prerequisites required/);await db.exec("rollback;set webnovels.site_display_apply_verified='true'");
 await db.exec(sql);assert.equal((await rows('select count(*)::int n from works'))[0].n,original);
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);try{
   for(const table of ['draft','releases','actions','receipts','audit'])await assert.rejects(rows('select * from launch_recovery.site_display_'+table),error=>error.code==='42501');
   await assert.rejects(rows('select launch_recovery.site_display_default()'),error=>error.code==='42501');
   if(role==='service_role'){assert.equal((await published()).ready,true);assert.equal((await get()).ready,true);}
   else{await assert.rejects(published(),error=>error.code==='42501');await assert.rejects(get(),error=>error.code==='42501');}
  }finally{await db.exec('reset role');}
 }
 assert.equal((await rows("select count(*)::int n from authoring.migrations where version='launch-018-site-display'"))[0].n,1);
});

test('legacy selections are review-only and cannot populate or mutate the new source',async()=>{
 const legacy=await call('legacy');assert.deepEqual(legacy.items.map(row=>row.work.id),['1','2','3','4','5','6']);assert.match(legacy.items[3].origins[0],/^PLACEMENT HOME_RECOMMENDED #1/);
 assert.equal(legacy.items[5].origins.length,20);assert(legacy.items.every(item=>item.origins.every(origin=>typeof origin==='string'&&origin.length<=240)));
 assert.deepEqual((await get()).draft.document.selections,[]);assert.deepEqual((await published()).items,[]);assert.equal((await published()).home.hero,null);
 await assert.rejects(db.exec('update public.works set is_top_recommended=false where id=1'),/SITE_DISPLAY_REQUIRED/);
 await assert.rejects(rows("select public.launch_admin_console($1,'curation-update',$2)",[admin,{workId:'1',revision:'0',flags:{is_top_recommended:false,is_popular_work:false,is_new_work:false},reason:'이전 RPC 우회 확인'}]),/SITE_DISPLAY_REQUIRED/);
 await assert.rejects(db.exec("insert into public.works(id,author_id,title,is_new_work) values(999,1,'우회',true)"),/SITE_DISPLAY_REQUIRED/);
 await assert.rejects(db.exec('update authoring.editorial_placements set enabled=false'),/SITE_DISPLAY_REQUIRED/);
 await assert.rejects(db.exec('delete from authoring.editorial_placements'),/SITE_DISPLAY_REQUIRED/);
 await db.exec("update public.works set description='정상 작품 설명' where id=1");
 await db.exec('begin');try{
  await db.exec("insert into public.works(id,author_id,title,content_type,status,is_top_recommended,is_popular_work,is_new_work) values(999,1,'작가 신규 원고','WEBTOON','DRAFT',false,false,false)");
  assert.equal((await rows('select count(*)::int n from works where id=999'))[0].n,1,'normal creator-style creation still succeeds');
 }finally{await db.exec('rollback');}
 assert.equal((await rows('select is_top_recommended flag from works where id=1'))[0].flag,true);
});

test('real work search is paginated beyond fifty, literal and includes both formats with eligibility reasons',async()=>{
 const first=await call('search',{q:'',type:'ALL',offset:0});assert.equal(first.items.length,50);assert.equal(first.total,91);assert.equal(first.nextOffset,50);
 const second=await call('search',{offset:50});assert.equal(second.items.length,41);assert.equal(second.nextOffset,null);
 assert.deepEqual((await call('search',{q:'정확%_'})).items.map(row=>row.id),['10']);assert.equal((await call('search',{q:"' OR 1=1 --"})).total,0);
 assert.equal((await call('search',{q:'현재 필명',type:'WEBTOON'})).items.every(row=>row.content_type==='WEBTOON'),true);
 assert.deepEqual((await call('search',{q:'9007199254740993'})).items.map(row=>row.id),['9007199254740993']);
 assert.equal((await call('search',{q:'작품 85'})).items[0].eligible,false);
 assert.equal((await call('search',{q:'작품 88',type:'WEBTOON'})).items[0].content_type,'WEBTOON','current content_type takes precedence over legacy type');
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE_MANUSCRIPT|PRIVATE_MANIFEST/);
});

test('manual list order and pagination are independent of eight home slots and never autofill',async()=>{
 const document=await doc();document.selections=Array.from({length:60},(_,i)=>select(60-i,i===0?'HERO':i<8?'FEATURED':'NONE'));
 await publish(document);
 const first=await published(),second=await published({offset:24}),third=await published({offset:48});
 assert.deepEqual([...first.items,...second.items,...third.items].map(row=>row.id),document.selections.map(row=>row.workId));
 assert.equal(first.limit,24);assert.equal(first.total,60);assert.equal(first.nextOffset,24);assert.equal(third.items.length,12);
 assert.equal(first.home.hero.id,'60');assert.deepEqual(first.home.featured.map(row=>row.id),['59','58','57','56','55','54','53']);
 const webtoon=await published({type:'WEBTOON'});assert.equal(webtoon.total,30);assert(webtoon.items.every(row=>row.content_type==='WEBTOON'));
 assert.equal(first.items[0].author,'현재 필명');assert(first.items.every(row=>!Object.hasOwn(row,'is_top_recommended')));
});

test('current eligibility excludes blocked, adult, unpublished and nonfree works without replacing them',async()=>{
 const document=await doc();document.selections=[select(1,'HERO'),select(85),select(86),select(87),select(88,'FEATURED'),select(89),select(90)];
 const saved=await save(document),preview=await call('preview',{revision:saved.draft.revision,at:'2030-01-01T00:00:00Z'});
 assert.deepEqual(preview.public.items.map(row=>row.id),['1','88']);assert.equal(preview.excluded.length,5);
 assert.equal(saved.selectionCards.length,7);assert.equal(saved.selectionCards.find(card=>card.id==='85').eligible,false);
 await call('publish',mutation({revision:saved.draft.revision,startsAt:iso(-1000),endsAt:null}));
 await db.exec('update public.works set eligible=false where id=1');
 assert.deepEqual((await published()).items.map(row=>row.id),['88']);assert.equal((await published()).home.hero,null,'a hidden hero is not replaced by another popular work');
 await db.exec(`update auth.users set banned_until=now()+interval '1 day' where id='${author}'`);
 assert.deepEqual((await published()).items,[]);
});

test('preview periods are half-open and never forecast publication; notices and menus remain structured',async()=>{
 const document=await doc();document.selections=[select(1,'HERO',{startsAt:'2030-01-01T00:00:00Z',endsAt:'2030-01-02T00:00:00Z'}),select(87)];
 document.notices=[{id:uuid(),title:'운영 안내',body:'두 줄\n공지',href:'/policies/refund/',startsAt:'2030-01-01T00:00:00Z',endsAt:'2030-01-02T00:00:00Z',enabled:true}];
 document.footerNote='필수 회사·정책 링크는 별도 유지';document.menus.reverse();document.blocks.reverse();
 const saved=await save(document);assert.equal(saved.error,undefined);
 const start=await call('preview',{revision:saved.draft.revision,at:'2030-01-01T00:00:00Z'});assert.deepEqual(start.public.items.map(row=>row.id),['1']);assert.equal(start.public.notices.length,1);assert.equal(start.public.menus[0].key,'ranking');
 const end=await call('preview',{revision:saved.draft.revision,at:'2030-01-02T00:00:00Z'});assert.deepEqual(end.public.items,[]);assert.equal(end.public.notices.length,0);
 assert.equal((await published({at:'2030-01-01T00:00:00Z'})).error,'INVALID_DISPLAY_QUERY');
 const live=await published();assert.deepEqual(live.items,[],'drafts are not public');assert.equal(live.publication,null);assert.equal(live.revision,'0');
 assert.deepEqual(live.home,{hero:null,featured:[]});assert.deepEqual(live.notices,[]);assert.equal(live.footerNote,'');
});

test('draft CAS, exact retries and current permissions apply before receipt lookup',async()=>{
 const document=await doc();document.selections=[select(1)];const data=mutation({revision:'0',document});
 const saved=await call('save',data,curator);assert.equal(saved.draft.revision,'1');assert.deepEqual(await call('save',data,curator),saved);
 assert.equal((await call('save',{...data,reason:'다른 작업'},curator)).error,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call('save',mutation({revision:'0',document}),curator)).error,'DISPLAY_CONFLICT');
 await db.exec(`update public.admin_users set permissions='{}' where auth_user_id='${curator}'`);
 assert.equal((await call('save',data,curator)).error,'ADMIN_FORBIDDEN');assert.equal((await call('get',{},viewer)).error,'ADMIN_FORBIDDEN');
 await db.exec(`update auth.users set banned_until=now()+interval '1 day' where id='${admin}'`);
 assert.equal((await get()).error,'ACCOUNT_REQUIRED');
});

test('publish and stop advance the global revision while replay precedes CAS and date validation',async()=>{
 const document=await doc();document.selections=[select(1)];const saved=await save(document);
 const payload=mutation({revision:saved.draft.revision,startsAt:iso(-1000),endsAt:null}),released=await call('publish',payload);
 assert.equal(released.draft.revision,'2');assert.equal((await call('save',mutation({revision:'1',document}))).error,'DISPLAY_CONFLICT');
 assert.equal((await call('publish',mutation({revision:'1',startsAt:iso(-500),endsAt:null}))).error,'DISPLAY_CONFLICT');
 const stopped=await call('stop',mutation({releaseId:released.releases[0].id}));assert.equal(stopped.draft.revision,'3');assert.deepEqual(await call('publish',payload),released);
 assert.equal((await call('publish',mutation({revision:'3',startsAt:iso(-600000),endsAt:null}))).error,'INVALID_DISPLAY_REQUEST');
 const old=mutation({revision:'0',startsAt:'2000-01-01T00:00:00Z',endsAt:null});
 await rows("insert into launch_recovery.site_display_receipts(actor_id,request_id,action,fingerprint,result,created_at) values($1,$2,'publish',encode(sha256(convert_to(jsonb_build_object('action','publish','data',$3::jsonb)::text,'UTF8')),'hex'),$4,now()-interval '1 hour')",[admin,old.requestId,old,released]);
 assert.deepEqual(await call('publish',old),released,'an earlier unknown-outcome receipt replays without revalidating its historical start');
});

test('expired newest version returns empty defaults instead of an older manual selection',async()=>{
 const a=await doc(),b=await doc();a.selections=[select(1)];b.selections=[select(2)];
 await rows("insert into launch_recovery.site_display_releases(number,document,draft_revision,starts_at,ends_at,actor_id,reason) values(1,$1,0,now()-interval '2 hours',null,$3,'기존 발행'),(2,$2,0,now()-interval '1 hour',now()-interval '1 minute',$3,'기간 종료')",[a,b,admin]);
 const publicResult=await published();assert.deepEqual(publicResult.items,[]);assert.equal(publicResult.publication,null);assert.equal(publicResult.revision,'0');
});

test('scheduled cancellation, stop, expiration and restoration never resurrect an older publication',async()=>{
 const first=await doc();first.selections=[select(1)];const a=await publish(first);const oldId=a.releases[0].id;
 const second=await doc();second.selections=[select(2)];const b=await publish(second,{startsAt:iso(86400000)});const scheduled=b.releases[0].id;
 assert.deepEqual((await published()).items.map(row=>row.id),['1']);
 const cancelled=await call('stop',mutation({releaseId:scheduled}));assert.equal(cancelled.releases.find(row=>row.id===scheduled).cancelled,true);assert.deepEqual((await published()).items.map(row=>row.id),['1']);
 const immediate=await call('publish',mutation({revision:cancelled.draft.revision,startsAt:iso(-500),endsAt:null}));const currentId=immediate.releases[0].id;
 assert.deepEqual((await published()).items.map(row=>row.id),['2']);await call('stop',mutation({releaseId:currentId}));assert.deepEqual((await published()).items,[]);
 const restored=await call('restore',mutation({releaseId:oldId,revision:(await get()).draft.revision}));assert.deepEqual(restored.draft.document.selections.map(row=>row.workId),['1']);assert.deepEqual((await published()).items,[],'restoration edits the draft only');
 await call('publish',mutation({revision:restored.draft.revision,startsAt:iso(-100),endsAt:null}));assert.deepEqual((await published()).items.map(row=>row.id),['1']);
});

test('invalid duplicate selections, slots, arbitrary menus and HTML/script notices are rejected atomically',async()=>{
 const base=await doc();base.selections=[select(1)];
 const invalid=[];
 let d=structuredClone(base);d.selections.push({...select(1)});invalid.push(d);
 d=structuredClone(base);d.selections=[select(1,'HERO'),select(2,'HERO')];invalid.push(d);
 d=structuredClone(base);d.selections=Array.from({length:9},(_,i)=>select(i+1,'FEATURED'));invalid.push(d);
 d=structuredClone(base);d.selections=Array.from({length:201},(_,i)=>select(i+1));invalid.push(d);
 d=structuredClone(base);d.menus[0].visible=false;invalid.push(d);
 d=structuredClone(base);d.menus[0].key='admin';invalid.push(d);
 d=structuredClone(base);d.menus[0].href='/admin';invalid.push(d);
 d=structuredClone(base);d.blocks[0].html='<script>alert(1)</script>';invalid.push(d);
 d=structuredClone(base);d.notices=[{id:uuid(),title:'안내',body:'본문',href:'javascript:alert(1)',startsAt:null,endsAt:null,enabled:true}];invalid.push(d);
 d=structuredClone(base);d.notices=[{id:uuid(),title:'안내',body:'본문',href:'/works/9223372036854775808',startsAt:null,endsAt:null,enabled:true}];invalid.push(d);
 d=structuredClone(base);d.footerNote='<img src=x onerror=alert(1)>';invalid.push(d);
 d=structuredClone(base);d.selections[0].startsAt='2030-02-30T00:00:00Z';invalid.push(d);
 for(const document of invalid){const result=await call('save',mutation({revision:'0',document}));assert.equal(result.error,'INVALID_DISPLAY_DOCUMENT');assert.equal((await get()).draft.revision,'0');}
 assert.equal((await call('search',{q:123})).error,'INVALID_DISPLAY_REQUEST');assert.equal((await call('search',{offset:'0'})).error,'INVALID_DISPLAY_REQUEST');
 assert.equal((await published({offset:-1})).error,'INVALID_DISPLAY_QUERY');assert.equal((await published({type:'ADULT'})).error,'INVALID_DISPLAY_QUERY');
 const trailing=structuredClone(base);trailing.notices=[{id:uuid(),title:'홈 안내',body:'안내',href:'/home/',startsAt:null,endsAt:null,enabled:true}];assert.equal((await save(trailing)).saved,true);
});

test('published snapshots, actions, audit and receipts are immutable; exact replay remains valid at rate limit',async()=>{
 const document=await doc();document.selections=[select(1)];const saved=await publish(document);const release=saved.releases[0];
 await assert.rejects(db.exec("update launch_recovery.site_display_releases set reason='변조'"),/SITE_DISPLAY_IMMUTABLE/);
 await assert.rejects(db.exec('delete from launch_recovery.site_display_audit'),/SITE_DISPLAY_IMMUTABLE/);
 const stopping=mutation({releaseId:release.id});await call('stop',stopping);
 await assert.rejects(db.exec('delete from launch_recovery.site_display_actions'),/SITE_DISPLAY_IMMUTABLE/);
 const current=(await get()).draft.revision;
 for(let i=0;i<27;i++)await call('save',mutation({revision:String(Number(current)+i),document}));
 assert.equal((await call('save',mutation({revision:'28',document}))).error,'RATE_LIMITED');
 assert.equal((await call('stop',stopping)).saved,true,'same request replays before the new-write rate check');
});

test('real SQL responses cross admin/public API DTO projection with UTC microseconds and an active notice',async()=>{
 await db.exec("set timezone='Asia/Seoul'");
 const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
 const rpc=async(name,body)=>{
  let result;
  if(name==='admin_site_display')result=await call(body.p_action,body.p_data,body.p_user);
  else if(name==='site_display_public')result=await published(body.p_data);
  else assert.fail('unexpected display RPC '+name);
  if(result?.error)fail(result.status,result.error);return result;
 };
 const actor=(await rows('select public.launch_account_actor($1) actor',[admin]))[0].actor;
 const api=async(action,body={})=>siteDisplayAdminApi({request:new Request('https://app.test/api/v2/admin/display?action='+action,{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(body)}),user:{id:admin},actor,rpc,fail});
 const publicApi=()=>siteDisplayPublicApi({request:new Request('https://app.test/api/v2/display?offset=0&type=ALL'),rpc,fail});
 const initial=await api('get');assert.equal(initial.draft.revision,'0');assert.deepEqual((await publicApi()).items,[]);
 const search=await api('search',{q:'작품 88',type:'WEBTOON',offset:0});assert.equal(search.items[0].eligible,true);assert.equal(search.items[0].content_type,'WEBTOON');
 const legacy=await api('legacy',{offset:0});assert(legacy.items[0].origins[0].startsWith('FLAG '));assert.match(legacy.items.find(item=>item.work.id==='4').origins[0],/^PLACEMENT /);
 const document=structuredClone(initial.draft.document),start=iso(-60000).replace('Z','000+00:00'),end=iso(3600000).replace('Z','000Z');
 document.selections=[select(1,'HERO',{startsAt:start,endsAt:end}),select(88,'FEATURED')];
 document.notices=[{id:uuid(),title:'실제 전시 공지',body:'안전한 안내문',href:'/company/',startsAt:start,endsAt:end,enabled:true}];document.footerNote='추가 안내문';
 const saved=await api('save',mutation({revision:'0',document}));assert.equal(saved.selectionCards.length,2);
 const previewAt=iso(0).replace('Z','000+00:00'),rawPreview=await call('preview',{revision:saved.draft.revision,at:previewAt,offset:0});
 assert.equal(rawPreview.revision,saved.draft.revision);assert.match(rawPreview.at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/);assert(Array.isArray(rawPreview.excluded));
 const preview=await api('preview',{revision:saved.draft.revision,at:previewAt,offset:0});assert.equal(preview.public.notices[0].enabled,true);assert.equal(preview.public.notices[0].startsAt,start);assert.equal(preview.public.publication,null);
 assert.deepEqual((await publicApi()).notices,[],'a draft notice never reaches the public route');
 const released=await api('publish',mutation({revision:saved.draft.revision,startsAt:iso(-1000).replace('Z','000+00:00'),endsAt:null}));assert.equal(released.draft.revision,'2');
 const live=await publicApi();assert.deepEqual(live.items.map(item=>item.id),['1','88']);assert.equal(live.notices[0].endsAt,end);assert.equal(live.notices[0].enabled,true);assert.equal(live.footerNote,'추가 안내문');
 assert.doesNotMatch(JSON.stringify(live),/PRIVATE_MANUSCRIPT|PRIVATE_MANIFEST/);
 assert.equal((await rows("select current_setting('TimeZone') value"))[0].value,'Asia/Seoul','UTC serialization settings are function-scoped');
});
