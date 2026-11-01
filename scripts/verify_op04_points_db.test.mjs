import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader,limited,otherReader,uuid} from './fixtures/op04-db.mjs';
let f,db;
before(async()=>{f=await setup();db=f.db;await db.exec(sql);});
after(async()=>db?.close());
beforeEach(async()=>db.exec('begin'));
afterEach(async()=>db.exec('rollback'));
const error=(result,code,status)=>{assert.equal(result?.error,code,JSON.stringify(result));if(status)assert.equal(result.status,status);};
const count=async table=>Number((await db.query('select count(*) n from commerce.'+table)).rows[0].n);
async function rejects(query,pattern){await db.exec('savepoint denial');try{await assert.rejects(query(),pattern);}finally{await db.exec('rollback to savepoint denial;release savepoint denial');}}
const bought=async(type='novel')=>{await f.credit(500);const episode=f[type].episodes[2],q=await f.quote(episode.id),requestId=uuid(),purchase=await f.purchase(q.quote.id,requestId);assert.equal(purchase.chargedPoints,100,JSON.stringify(purchase));return {episode,q:q.quote,requestId,purchase};};

test('repeatable TEST migration has explicit service RPC and denies every direct private table/helper role',async()=>{
 assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0],f.baselineCommerce);
 assert.equal((await db.query('select label from commerce.legacy_sentinel where id=1')).rows[0].label,'existing TEST evidence');
 const tables=(await db.query("select tablename from pg_tables where schemaname='commerce' and tablename like 'op04_%' order by tablename")).rows;
 assert.equal(tables.length,10);
 for(const role of ['anon','authenticated','service_role']){
  for(const {tablename} of tables){await db.exec('savepoint role_denial');await db.exec('set role '+role);await assert.rejects(db.query('select * from commerce.'+tablename),/permission denied/);await db.exec('rollback to savepoint role_denial;release savepoint role_denial');}
  await db.exec('savepoint role_denial');await db.exec('set role '+role);await assert.rejects(db.query('select commerce.op04_admin_state()'),/permission denied/);await db.exec('rollback to savepoint role_denial;release savepoint role_denial');
  await db.exec('savepoint role_rpc');await db.exec('set role '+role);
  if(role==='service_role')assert.equal((await f.call('wallet')).balancePoints,0);else await assert.rejects(f.call('wallet'),/permission denied/);
  await db.exec('rollback to savepoint role_rpc;release savepoint role_rpc');
 }
 const funcs=(await db.query("select p.prosecdef,p.proconfig from pg_proc p where p.oid='public.op04_points_test(uuid,text,jsonb)'::regprocedure")).rows[0];assert.equal(funcs.prosecdef,true);assert.ok(funcs.proconfig.includes('search_path=""'));
 const rls=(await db.query("select bool_and(relrowsecurity) ok from pg_class where relnamespace='commerce'::regnamespace and relname like 'op04_%' and relkind='r'")).rows[0].ok;assert.equal(rls,true);
 assert.equal((await f.state()).defaults.pricePoints,100);assert.equal(await count('op04_policies'),1);assert.equal(await count('op04_wallets'),0);
});

test('only confirmed active members read first two numbered episodes; later novel/webtoon metadata stays locked without body or paths',async()=>{
 for(const work of [f.novel,f.webtoon]){
  const episodes=await f.call('episodes',{workId:work.id});assert.deepEqual(episodes.items.map(row=>[row.episodeNumber,row.access,row.pricePoints]),[[1,'MEMBER_FREE',0],[2,'MEMBER_FREE',0],[3,'LOCKED',100]]);
  assert.equal(episodes.mode,'TEST');assert.equal(episodes.provenance,'LOCAL_SIMULATED');assert.ok(!JSON.stringify(episodes).includes('시험용 3화 본문'));assert.ok(!/"(?:path|bucket|panels|contentDocument)"/.test(JSON.stringify(episodes)));
  for(const episode of work.episodes.slice(0,2))assert.equal((await f.content(episode.id)).episodeId,episode.id);
  error(await f.content(work.episodes[2].id),'EPISODE_LOCKED',403);
 }
 error(await f.call('works',{},null),'INVALID_SESSION',401);
 error(await f.call('works',{},admin),'READER_REQUIRED',403);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[reader]);error(await f.content(f.novel.episodes[0].id),'INVALID_SESSION',401);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[reader]);await db.query("update readers set status='BLOCKED' where auth_user_id=$1",[reader]);error(await f.content(f.novel.episodes[0].id),'READER_REQUIRED',403);
});

test('free count uses stable episode number rather than filtered row position and unregistered work is unavailable',async()=>{
 await db.query("update episodes set status='DRAFT' where id=$1",[f.novel.episodes[0].id]);
 const rows=(await f.call('episodes',{workId:f.novel.id})).items;assert.deepEqual(rows.map(row=>row.access),['MEMBER_FREE','LOCKED']);
 assert.equal((await f.enroll(f.novel.id,false)).saved,true);error(await f.content(f.novel.episodes[1].id),'TEST_WORK_NOT_FOUND',404);
 const state=await f.state();assert.equal(state.works.find(row=>row.id===f.novel.id).enabled,false);assert.ok(!(await f.call('works')).items.some(row=>row.id===f.novel.id));
});

test('SUPER_ADMIN credit, revision CAS, immutable policy history and effective scope priority preserve default free range',async()=>{
 for(const action of ['admin-state','admin-search'])error(await f.call(action,{},limited),'ADMIN_FORBIDDEN',403);
 error(await f.call('admin-credit',{targetUserId:reader,points:100,reason:'시험 지급',requestId:uuid()},limited),'ADMIN_FORBIDDEN',403);
 const initial=await f.state(),requestId=uuid(),data={targetUserId:reader,points:1000,reason:'시험 지급 이유',requestId};
 const credit=await f.adminCall('credit',data);assert.equal(credit.balancePoints,1000);assert.equal((await f.adminCall('credit',data)).replayed,true);error(await f.adminCall('credit',{...data,points:1001}),'IDEMPOTENCY_CONFLICT',409);
 assert.equal((await f.policy('DEFAULT',null,150)).saved,true);assert.equal((await f.state()).defaults.pricePoints,150);
 error(await f.adminCall('enroll',{workId:f.novel.id,enabled:false,revision:initial.revision,reason:'동시 편집 확인',requestId:uuid()}),'REVISION_CONFLICT',409);
 await f.policy('WORK',f.novel.id,120);await f.policy('EPISODE',f.novel.episodes[2].id,75);
 assert.equal((await f.quote(f.novel.episodes[2].id)).quote.pricePoints,75);assert.equal((await f.quote(f.webtoon.episodes[2].id)).quote.pricePoints,150);assert.equal((await f.quote(f.novel.episodes[0].id)).quote.pricePoints,0);
 const future=new Date(Date.now()+3600000).toISOString();await f.policy('EPISODE',f.novel.episodes[2].id,999,{startsAt:future});assert.equal((await f.quote(f.novel.episodes[2].id)).quote.pricePoints,75);
 assert.equal(await count('op04_policies'),5);
 await rejects(()=>db.query('update commerce.op04_policies set points=1'),/OP04_TEST_EVIDENCE_IMMUTABLE/);
 for(const points of [-1,1.1,1000001,'100'])error(await f.policy('DEFAULT',null,points),'INVALID_TEST_REQUEST',400);
});

test('insufficient points, stale prices, expired quotes and head replacements never debit or grant rights',async()=>{
 const episode=f.novel.episodes[2],q=(await f.quote(episode.id)).quote;
 error(await f.purchase(q.id),'INSUFFICIENT_POINTS',409);assert.equal(await count('op04_ledger'),0);assert.equal(await count('op04_entitlements'),0);
 await f.credit(1000);await f.policy('EPISODE',episode.id,200);error(await f.purchase(q.id),'PRICE_CHANGED',409);
 const next=(await f.quote(episode.id)).quote;error(await f.purchase(await f.expiredQuote(next.id)),'QUOTE_EXPIRED',409);
 await f.replaceHead(episode);error(await f.purchase(next.id),'PUBLICATION_CHANGED',409);
 assert.equal((await f.call('wallet')).balancePoints,1000);assert.equal(await count('op04_purchases'),0);assert.equal(await count('op04_entitlements'),0);
});

test('purchase receipt replay and different tab request IDs debit once and keep the ledger sum equal to wallet',async()=>{
 await f.credit(300);const episode=f.novel.episodes[2],q=(await f.quote(episode.id)).quote,requestId=uuid();
 const purchased=await f.purchase(q.id,requestId);assert.equal(purchased.chargedPoints,100);assert.equal(purchased.balancePoints,200);
 const retry=await f.purchase(q.id,requestId);assert.equal(retry.replayed,true);assert.equal(retry.entitlementId,purchased.entitlementId);
 const other=await f.purchase(q.id,uuid());assert.equal(other.chargedPoints,0);assert.equal(other.entitlementId,purchased.entitlementId);
 const another=(await f.quote(f.novel.episodes[1].id)).quote;error(await f.purchase(another.id,requestId),'IDEMPOTENCY_CONFLICT',409);
 assert.equal(await count('op04_purchases'),1);assert.equal(await count('op04_entitlements'),1);assert.equal((await db.query("select count(*) n from commerce.op04_ledger where kind='DEBIT'")).rows[0].n,1);
 assert.equal(Number((await db.query('select sum(delta_points) n from commerce.op04_ledger where user_id=$1',[reader])).rows[0].n),(await f.call('wallet')).balancePoints);
 // These are sequential DB requests; actual multi-connection PostgreSQL concurrency is a separate acceptance item.
 await rejects(()=>db.query('delete from commerce.op04_ledger'),/OP04_TEST_EVIDENCE_IMMUTABLE/);
 await rejects(()=>db.query('delete from commerce.op04_receipts'),/OP04_TEST_EVIDENCE_IMMUTABLE/);
});

test('owned stable episode reopens after price/head change while hidden, removed or revoked access remains closed',async()=>{
 const {episode,q,purchase}=await bought();await f.policy('EPISODE',episode.id,999);const head=await f.replaceHead(episode);
 const reopen=await f.purchase(q.id);assert.equal(reopen.chargedPoints,0);assert.equal(reopen.entitlementId,purchase.entitlementId);
 const body=await f.content(episode.id);assert.equal(body.versionId,head.versionId);assert.equal(body.content,'승인된 TEST 수정 본문');assert.equal((await f.call('wallet')).balancePoints,400);
 await db.query('update commerce.op04_entitlements set revoked_at=now() where id=$1',[purchase.entitlementId]);error(await f.content(episode.id),'EPISODE_LOCKED',403);
 await db.query('update commerce.op04_entitlements set revoked_at=null where id=$1',[purchase.entitlementId]);
 await db.query("update commerce.op04_entitlements set granted_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' where id=$1",[purchase.entitlementId]);error(await f.content(episode.id),'EPISODE_LOCKED',403);
 await db.query('update commerce.op04_entitlements set expires_at=null where id=$1',[purchase.entitlementId]);
 await db.query("update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='합성 제재 시험' where work_id=$1",[f.novel.id]);error(await f.content(episode.id),'CONTENT_NOT_AVAILABLE',404);
 await db.query("update authoring.work_state set moderation_state='CLEAR' where work_id=$1",[f.novel.id]);await db.query('delete from authoring.publication_heads where episode_id=$1',[episode.id]);error(await f.content(episode.id),'CONTENT_NOT_AVAILABLE',404);
});

test('webtoon panel path requires the same member entitlement, current head, manifest and eligible work',async()=>{
 const episode=f.webtoon.episodes[2];error(await f.panel(episode.id,episode.versionId,episode.panelId),'EPISODE_LOCKED',403);
 await f.credit(300);const q=(await f.quote(episode.id)).quote;await f.purchase(q.id);
 const body=await f.content(episode.id);assert.equal(body.contentType,'WEBTOON');assert.equal(body.content,null);assert.equal(body.contentDocument,null);assert.equal(body.panels.length,1);assert.ok(!JSON.stringify(body).includes('webtoon/'));
 const path=await f.panel(episode.id,episode.versionId,episode.panelId);assert.equal(path.bucket,'authoring-webtoons');assert.equal(path.bytes,null);assert.equal(path.mimeType,'image/webp');assert.match(path.path,/^webtoon\/31\/[0-9a-f-]+\/0\/[a-f0-9]{64}\.webp$/);
 error(await f.panel(episode.id,episode.versionId,episode.panelId,'webp',otherReader),'EPISODE_LOCKED',403);
 error(await f.panel(episode.id,episode.versionId,f.webtoon.episodes[0].panelId),'CONTENT_NOT_AVAILABLE',404);
 const head=await f.replaceHead(episode,{newAsset:true});error(await f.panel(episode.id,episode.versionId,episode.panelId),'CONTENT_NOT_AVAILABLE',404);assert.equal((await f.panel(episode.id,head.versionId,head.panelId)).bucket,'authoring-webtoons');
 await db.query("update public.works set rating='AGE_19' where id=$1",[f.webtoon.id]);error(await f.content(episode.id),'CONTENT_NOT_AVAILABLE',404);error(await f.panel(episode.id,head.versionId,head.panelId),'CONTENT_NOT_AVAILABLE',404);
});

test('cross-account quotes and unsupported fields or malformed IDs never authorize a purchase',async()=>{
 const episode=f.novel.episodes[2],q=(await f.quote(episode.id)).quote;
 error(await f.purchase(q.id,uuid(),otherReader),'QUOTE_NOT_FOUND',404);
 error(await f.call('quote',{episodeId:episode.id,userId:otherReader}),'INVALID_TEST_REQUEST',400);
 for(const id of [episode.id*1,'0','-1','9223372036854775808','not-an-id'])error(await f.content(id),'INVALID_TEST_REQUEST',400);
 error(await f.call('works',{offset:1.5}),'INVALID_TEST_REQUEST',400);
 error(await f.adminCall('credit',{targetUserId:reader,points:100,reason:'x',requestId:uuid()}),'REASON_REQUIRED',400);
 await db.query("update public.admin_users set is_active=false where auth_user_id=$1",[admin]);error(await f.state(),'ADMIN_FORBIDDEN',403);
 assert.equal(await count('op04_purchases'),0);
});

test('quote issuance is durably limited and replay authorization is rechecked before receipts',async()=>{
 const episode=f.novel.episodes[2];for(let i=0;i<60;i++)assert.ok((await f.quote(episode.id)).quote);
 error(await f.quote(episode.id),'RATE_LIMITED',429);assert.equal(await count('op04_quotes'),60);
 const data={targetUserId:reader,points:100,reason:'관리자 재검증 시험',requestId:uuid()};assert.equal((await f.adminCall('credit',data)).creditedPoints,100);
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);error(await f.adminCall('credit',data),'ADMIN_FORBIDDEN',403);
});

test('ambiguous reader profile mapping cannot read or receive TEST credit',async()=>{
 const indexes=(await db.query("select indexname from pg_indexes where schemaname='public' and tablename='readers' and indexdef like '%UNIQUE%' and indexdef like '%auth_user_id%'")).rows;
 for(const row of indexes)await db.exec('drop index public."'+row.indexname.replaceAll('"','""')+'"');
 await db.query('insert into public.readers(id,auth_user_id,status) values($1,$2,$3)',[uuid(),reader,'ACTIVE']);
 error(await f.content(f.novel.episodes[0].id),'READER_REQUIRED',403);error(await f.credit(100),'READER_REQUIRED',403);
 assert.equal(await count('op04_wallets'),0);assert.equal(await count('op04_ledger'),0);
});

test('bounded enrolled state accepts existing toggles but rejects a 1001st entry before mutation',async()=>{
 await db.exec("insert into public.works(id,author_id,status,rating,title,content_type) select x,1,'DRAFT','ALL','한도 TEST','NOVEL' from generate_series(1000,1997) x;insert into commerce.op04_works(work_id,enabled,actor_id,reason) select x,false,'11111111-1111-4111-8111-111111111111','합성 한도검증' from generate_series(1000,1997) x");
 assert.equal((await f.state()).works.length,1000);
 error(await f.enroll('10'),'TEST_WORK_LIMIT',409);assert.equal(await count('op04_works'),1000);
 assert.equal((await f.enroll(f.novel.id,false)).saved,true);assert.equal((await f.state()).works.length,1000);
});

test('formatted current publication is returned as the validated Word document without consulting draft revisions',async()=>{
 const episode=f.novel.episodes[0],document={version:1,paragraphs:[{align:'center',indent:1,runs:[{text:'현재 공개 서식',bold:true,italic:true,underline:true}]}]};
 const head=await f.replaceHead(episode,{title:'현재 공개 서식',contentDocument:document});
 const result=await f.content(episode.id);assert.equal(result.versionId,head.versionId);assert.equal(result.content,'현재 공개 서식');assert.deepEqual(result.contentDocument,document);
 assert.ok(!JSON.stringify(result).includes('source_draft_id'));assert.ok(!JSON.stringify(result).includes('source_revision'));
});
