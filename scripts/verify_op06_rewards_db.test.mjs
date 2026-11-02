import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setup,sql,admin,reader,limited,otherReader,uuid,provider} from './fixtures/op06-db.mjs';
let f,db;
before(async()=>{f=await setup({openingPoints:500});db=f.db;});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
const error=(r,code,status)=>{assert.equal(r?.error,code,JSON.stringify(r));if(status)assert.equal(r.status,status);};
const count=async table=>Number((await db.query('select count(*) n from commerce.'+table)).rows[0].n);
const enable=changes=>f.rewardPolicy({adEnabled:true,...changes});
const campaign=changes=>f.rewardPolicy({campaignEnabled:true,campaignTitle:'무료 캠페인 TEST',campaignStartsAt:new Date(Date.now()-60000).toISOString(),campaignEndsAt:new Date(Date.now()+86400000).toISOString(),...changes});
async function expiredSession(id){await db.query("update commerce.op06_sessions set created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes',accept_until=now()+interval '5 minutes' where id=$1",[id]);}

test('reviewed apply preserves original RPC, owner, table rows and commerce ACL with disabled policy only',async()=>{
 assert.match(sql,/webnovels\.ad_rewards_test_apply_verified/);assert.equal((await f.adminRewards('state')).policy.adEnabled,false);assert.equal((await f.adminRewards('state')).policy.campaignEnabled,false);assert.equal(await count('op06_sessions'),0);assert.equal(await count('op06_grants'),0);
 const original=(await db.query("select oid::text,prosrc,proowner::text,proconfig,proacl::text from pg_proc where oid='commerce.op05_points_base(uuid,text,jsonb)'::regprocedure")).rows[0];assert.deepEqual(original,f.originalBase);
 assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0],f.baselineCommerce);
 await db.exec('savepoint apply_guard');await assert.rejects(db.exec(sql),/Reviewed OP-06/);await db.exec('rollback to savepoint apply_guard;release savepoint apply_guard');
});

test('real SET ROLE denies private tables and helper/base execute; only service public RPCs are exposed',async()=>{
 const tables=(await db.query("select tablename from pg_tables where schemaname='commerce' and tablename like 'op06_%'")).rows;assert.equal(tables.length,7);
 for(const role of ['anon','authenticated','service_role']){
  for(const {tablename}of tables){await db.exec('savepoint acl');await db.exec('set role '+role);await assert.rejects(db.query('select * from commerce.'+tablename),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');}
  for(const signature of ['commerce.op06_state()','commerce.op06_session(null)','commerce.op06_reward_access(null,null)','commerce.op05_points_base(null,null)']){await db.exec('savepoint acl');await db.exec('set role '+role);await assert.rejects(db.query('select '+signature),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');}
  await db.exec('savepoint acl');await db.exec('set role '+role);if(role==='service_role')assert.equal((await f.adminRewards('state')).mode,'TEST');else await assert.rejects(f.adminRewards('state'),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');
  await db.exec('savepoint acl');await db.exec('set role '+role);if(role==='service_role')error(await f.applyEvidence({}),'INVALID_REWARD_EVIDENCE',400);else await assert.rejects(f.applyEvidence({}),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');
 }
});

test('no advertising defaults to 10000KRW/10000P charging without granting or changing wallet',async()=>{
 const before=await f.wallet(),options=await f.options(undefined,{provider:'NONE',channelId:null,binding:null});assert.equal(options.availability,'UNAVAILABLE');assert.equal(options.adAvailable,false);assert.deepEqual(options.fallback,{kind:'POINTS',chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100});
 const unavailable=await f.start();assert.equal(unavailable.availability,'UNAVAILABLE');assert.equal(unavailable.session,null);assert.equal(await count('op06_sessions'),0);assert.equal(await count('op06_grants'),0);assert.deepEqual(await f.wallet(),before);
});

test('policy changes require current SUPER_ADMIN, strict fields, CAS and immutable exact request receipts',async()=>{
 const state=await f.adminRewards('state'),{id,...p}=state.policy,requestId=uuid(),body={...p,adEnabled:true,revision:state.revision,reason:'명시 정책 변경',requestId};const saved=await f.adminRewards('policy',body);assert.equal(saved.saved,true);assert.equal((await f.adminRewards('policy',body)).replayed,true);error(await f.adminRewards('policy',{...body,adEnabled:false}),'IDEMPOTENCY_CONFLICT',409);
 error(await f.adminRewards('policy',{...body,requestId:uuid()}),'REVISION_CONFLICT',409);error(await f.rewards('admin-state',{},limited),'ADMIN_FORBIDDEN',403);
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);error(await f.adminRewards('policy',body),'ADMIN_FORBIDDEN',403);
});

test('invalid policy ranges, missing fields and malformed dates never create a new version',async()=>{
 for(const changes of [{rewardHours:0},{rewardHours:169},{sessionMinutes:31},{graceMinutes:61},{dailyLimit:0},{adEnabled:'true'},{campaignEnabled:true},{campaignStartsAt:'2026-02-31'},{campaignTitle:'x'.repeat(101)},{extra:'forged'}])error(await f.rewardPolicy(changes),'INVALID_REWARD_REQUEST',400);
 assert.equal((await f.adminRewards('state')).revision,'0');assert.equal(await count('op06_policies'),1);
});

test('start snapshots version, hours, channel and nonce; status projects no private identifiers',async()=>{
 await enable();const started=await f.start(),session=started.session;assert.equal(session.status,'WAITING_EVIDENCE');assert.equal(session.rewardHours,24);assert.match(started.challenge.nonce,/^[a-f0-9]{64}$/);assert.equal(started.challenge.policyVersion,session.policyVersion);assert.equal(session.episodeId,f.novel.episodes[2].id);
 await f.rewardPolicy({adEnabled:false,rewardHours:1,sessionMinutes:1});const current=await f.rewards('status',{sessionId:session.id});assert.equal(current.session.policyVersion,session.policyVersion);assert.equal(current.session.rewardHours,24);assert.doesNotMatch(JSON.stringify(current),/userId|nonce|binding|publication_id|channelId/);assert.equal(current.challenge,undefined);
});

test('start requires the exact consented policy version and retries keep the original accepted terms',async()=>{
 await enable();const policyVersion=(await f.options()).policy.id,requestId=uuid(),started=await f.start(undefined,'AD_REWARD',{policyVersion,requestId});await f.rewardPolicy({rewardHours:48});
 error(await f.start(f.webtoon.episodes[2].id,'AD_REWARD',{policyVersion}),'REWARD_POLICY_CHANGED',409);
 const receiptCount=await count('op06_receipts');error(await f.start(),'REWARD_SESSION_PENDING',409);assert.equal(await count('op06_sessions'),1);assert.equal(await count('op06_receipts'),receiptCount);
 const retry=await f.start(undefined,'AD_REWARD',{policyVersion,requestId});assert.equal(retry.replayed,true);assert.equal(retry.session.policyVersion,policyVersion);assert.equal(retry.session.rewardHours,24);assert.equal(retry.session.id,started.session.id);
 assert.equal((await f.applyEvidence(f.evidence(started))).session.rewardHours,24);
 error(await f.rewards('start',{episodeId:f.webtoon.episodes[2].id,kind:'AD_REWARD',consent:true,requestId:uuid(),...provider}),'INVALID_REWARD_REQUEST',400);assert.equal(await count('op06_sessions'),1);
});

test('exact start retry preserves one session; another request resumes pending instead of consuming another budget',async()=>{
 await enable();const requestId=uuid(),first=await f.start(undefined,'AD_REWARD',{requestId});const replay=await f.start(undefined,'AD_REWARD',{requestId});assert.equal(replay.replayed,true);assert.deepEqual(replay.session,first.session);assert.deepEqual(replay.challenge,first.challenge);const next=await f.start();assert.equal(next.session.id,first.session.id);assert.equal(await count('op06_sessions'),1);
 error(await f.start(f.webtoon.episodes[2].id,'AD_REWARD',{requestId}),'IDEMPOTENCY_CONFLICT',409);error(await f.closeReward(first.session.id,{requestId}),'IDEMPOTENCY_CONFLICT',409);
});

test('verified completion grants one stable episode right and no points, purchases or author earnings',async()=>{
 await enable();const before=await f.wallet(),ledger=await count('op04_ledger'),{started,proof,applied}=await f.grantAd();assert.equal(applied.session.status,'GRANTED');assert.equal(applied.session.grant.kind,'AD_REWARD');assert.equal(await count('op06_grants'),1);assert.equal(await count('op06_events'),1);assert.equal(await count('op04_purchases'),0);assert.equal(await count('op04_entitlements'),0);assert.equal(await count('op04_ledger'),ledger);assert.deepEqual(await f.wallet(),before);
 const replay=await f.applyEvidence(proof);assert.equal(replay.replayed,true);assert.equal(replay.session.grant.expiresAt,applied.session.grant.expiresAt);assert.equal(await count('op06_grants'),1);assert.equal((await f.rewards('status',{sessionId:started.session.id})).session.status,'GRANTED');
});

test('all original metadata/quote/content/purchase paths agree on temporary access and 0P without permanent entitlement',async()=>{
 await enable();const {applied}=await f.grantAd(),episode=f.novel.episodes[2];const list=await f.call('episodes',{workId:f.novel.id});assert.equal(list.items[2].access,'AD_REWARD');assert.equal(list.items[2].rewardAccess.grantId,applied.session.grant.id);
 const q=await f.quote(episode.id);assert.equal(q.quote.access,'AD_REWARD');assert.equal(q.quote.rewardAccess.kind,'AD_REWARD');assert.equal((await f.content(episode.id)).episodeId,episode.id);const result=await f.purchase(q.quote.id);assert.equal(result.access,'AD_REWARD');assert.equal(result.chargedPoints,0);assert.equal(result.entitlementId,null);assert.equal(result.rewardAccess.expiresAt,applied.session.grant.expiresAt);assert.equal(await count('op04_purchases'),0);
});

test('expired ad rights and historical 0P request replay cannot reopen protected novel or extend access',async()=>{
 await enable();const {applied}=await f.grantAd(),episode=f.novel.episodes[2],quote=await f.quote(episode.id),requestId=uuid();await f.purchase(quote.quote.id,requestId);await f.expireGrant(applied.session.grant.id);
 assert.equal((await f.quote(episode.id)).quote.access,'LOCKED');error(await f.content(episode.id),'EPISODE_LOCKED',403);error(await f.purchase(quote.quote.id,requestId),'REWARD_EXPIRED',409);assert.equal(await count('op04_entitlements'),0);assert.equal(await count('op04_purchases'),0);
});

test('cross-reader status, close, novel and webtoon access never borrow another account grant',async()=>{
 await enable();const {applied}=await f.grantAd();error(await f.rewards('status',{sessionId:applied.session.id},otherReader),'SESSION_NOT_FOUND',404);error(await f.closeReward(applied.session.id,{},otherReader),'SESSION_NOT_FOUND',404);error(await f.content(f.novel.episodes[2].id,otherReader),'EPISODE_LOCKED',403);
 const comic=f.webtoon.episodes[2];await f.grantAd(comic.id);assert.equal((await f.panel(comic.id,comic.versionId,comic.panelId)).bucket,'authoring-webtoons');error(await f.panel(comic.id,comic.versionId,comic.panelId,'webp',otherReader),'EPISODE_LOCKED',403);const replacement=await f.replaceHead(comic,{newAsset:true});error(await f.panel(comic.id,comic.versionId,comic.panelId),'CONTENT_NOT_AVAILABLE',404);assert.equal((await f.panel(comic.id,replacement.versionId,replacement.panelId)).bucket,'authoring-webtoons');
});

test('old session terms survive policy disable, head replacement and hidden content cannot bypass current visibility',async()=>{
 await enable();const started=await f.start();await f.rewardPolicy({adEnabled:false,rewardHours:1});const head=await f.replaceHead(f.novel.episodes[2]);const applied=await f.applyEvidence(f.evidence(started));assert.equal(applied.session.rewardHours,24);assert.equal((await f.content(head.id)).versionId,head.versionId);
 await db.query("update public.works set status='DRAFT' where id=$1",[f.novel.id]);error(await f.content(head.id),'CONTENT_NOT_AVAILABLE',404);assert.equal(await count('op06_grants'),1);
});

test('nonce/channel/binding/reward mismatches and forged extra fields create no grant or event',async()=>{
 await enable();const started=await f.start();for(const changes of [{nonce:'b'.repeat(64)},{binding:'b'.repeat(64)},{channelId:'other-channel'}])error(await f.applyEvidence(f.evidence(started,changes)),'REWARD_BINDING_MISMATCH',409);
 for(const changes of [{provider:'GOOGLE'},{outcome:'COMPLETE'},{reward:{type:'POINTS',quantity:100}},{reward:{type:'EPISODE_ACCESS',quantity:2}},{unknown:true},{sessionId:'not-a-uuid'}])error(await f.applyEvidence(f.evidence(started,changes)),'INVALID_REWARD_EVIDENCE',400);assert.equal(await count('op06_grants'),0);assert.equal(await count('op06_events'),0);
});

test('one stable channel event cannot be assigned to two sessions or reused after a binding change',async()=>{
 await enable();const a=await f.start(),proof=f.evidence(a);await f.applyEvidence(proof);const b=await f.start(f.webtoon.episodes[2].id);error(await f.applyEvidence(f.evidence(b,{eventId:proof.eventId})),'EVENT_CONFLICT',409);
 const c=await f.start(undefined,'AD_REWARD',{binding:'b'.repeat(64)},otherReader);error(await f.applyEvidence(f.evidence(c,{eventId:proof.eventId,binding:'b'.repeat(64)})),'EVENT_CONFLICT',409);assert.equal(await count('op06_grants'),1);
});

test('late completion inside session window and grace grants; outside completed window or receipt grace rejects',async()=>{
 await enable();const started=await f.start();await expiredSession(started.session.id);const row=(await db.query('select * from commerce.op06_sessions where id=$1',[started.session.id])).rows[0];const validTime=new Date(Date.parse(row.created_at)+60000).toISOString();assert.equal((await f.rewards('status',{sessionId:started.session.id})).session.status,'EXPIRED');const pending=await f.start();assert.equal(pending.session.id,started.session.id);assert.deepEqual(pending.challenge,started.challenge);assert.equal(await count('op06_sessions'),1);assert.equal((await f.applyEvidence(f.evidence(started,{completedAt:validTime}))).session.status,'GRANTED');
 const other=await f.start(f.webtoon.episodes[2].id);error(await f.applyEvidence(f.evidence(other,{completedAt:new Date(Date.now()+3600000).toISOString()})),'REWARD_EVIDENCE_EXPIRED',409);await db.query("update commerce.op06_sessions set created_at=now()-interval '30 minutes',expires_at=now()-interval '25 minutes',accept_until=now()-interval '15 minutes' where id=$1",[other.session.id]);error(await f.applyEvidence(f.evidence(other,{completedAt:new Date(Date.now()-28*60000).toISOString()})),'REWARD_EVIDENCE_EXPIRED',409);
});

test('closing preserves prior completed proof grace, rejects completion after close and never regresses granted',async()=>{
 await enable();const a=await f.start(),proof=f.evidence(a),closed=await f.closeReward(a.session.id);assert.equal(closed.session.status,'CLOSED_PENDING');const done=await f.applyEvidence(proof);assert.equal(done.session.status,'GRANTED');assert.equal((await f.closeReward(a.session.id)).session.status,'GRANTED');
 const b=await f.start(f.webtoon.episodes[2].id);await f.closeReward(b.session.id);const rejected=await f.applyEvidence(f.evidence(b,{completedAt:new Date(Date.parse(b.session.createdAt)+1).toISOString()}));assert.equal(rejected.session.status,'REJECTED');assert.equal(rejected.session.grant,null);
});

test('terminal GRANTED survives no-fill/rejected and duplicate delivery without another grant or expiry extension',async()=>{
 await enable();const {started,proof,applied}=await f.grantAd();for(const outcome of ['NO_FILL','REJECTED']){const observed=await f.applyEvidence(f.evidence(started,{outcome}));assert.equal(observed.session.status,'GRANTED');assert.equal(observed.session.grant.expiresAt,applied.session.grant.expiresAt);}assert.equal(await count('op06_grants'),1);assert.equal((await f.applyEvidence(proof)).replayed,true);
});

test('verified no-fill/rejection never issues a free fallback or touches paid balances',async()=>{
 await enable();for(const outcome of ['NO_FILL','REJECTED']){const started=await f.start();const applied=await f.applyEvidence(f.evidence(started,{outcome}));assert.equal(applied.session.status,outcome);assert.equal(applied.session.grant,null);}assert.equal(await count('op06_grants'),0);assert.equal((await f.wallet()).totalPoints,500);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'LOCKED');
});

test('explicit operator campaign is separate, requires active dates and claims once per policy without a provider',async()=>{
 await campaign();const options=await f.options(undefined,{provider:'NONE',channelId:null,binding:null});assert.equal(options.adAvailable,false);assert.equal(options.campaignAvailable,true);const started=await f.start(undefined,'CAMPAIGN_FREE');assert.equal(started.session.status,'GRANTED');assert.equal(started.session.grant.kind,'CAMPAIGN_FREE');assert.equal(started.challenge,undefined);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'CAMPAIGN_FREE');assert.equal(await count('op06_events'),0);assert.equal(await count('op04_ledger'),1);
 await f.expireGrant(started.session.grant.id);const again=await f.start(undefined,'CAMPAIGN_FREE');assert.equal(again.availability,'UNAVAILABLE');assert.equal(await count('op06_grants'),1);
});

test('existing free or purchased rights avoid unnecessary ad sessions and permanent rights remain dominant',async()=>{
 await enable();assert.equal((await f.start(f.novel.episodes[0].id)).availability,'ALREADY_ACCESSIBLE');const q=await f.quote(f.novel.episodes[2].id);const paid=await f.purchase(q.quote.id);assert.equal(paid.chargedPoints,100);assert.equal((await f.start()).availability,'ALREADY_ACCESSIBLE');assert.equal(await count('op06_sessions'),0);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'OWNED');
});

test('purchase acquired while evidence is pending remains permanent; callback cannot refund or replace it',async()=>{
 await enable();const s=await f.start(),q=await f.quote(f.novel.episodes[2].id),paid=await f.purchase(q.quote.id);assert.equal(paid.chargedPoints,100);await f.applyEvidence(f.evidence(s));assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'OWNED');assert.equal((await f.wallet()).totalPoints,400);assert.equal(await count('op04_entitlements'),1);assert.equal(await count('op06_grants'),1);
});

test('OP05 reserved refunds stay separate from ad grants and retained rights survive cash-source refund completion',async()=>{
 await enable();const p=await f.makeProduct({amountKrw:1000,points:1000}),order=(await f.create(p)).order;await f.deposit(order);const refund=await f.refund(order);assert.equal((await f.wallet()).reservedPoints,1000);assert.equal((await f.wallet()).balancePoints,500);
 const ad=await f.grantAd(),quote=await f.quote(f.webtoon.episodes[2].id);assert.equal((await f.purchase(quote.quote.id)).chargedPoints,100);assert.equal((await f.wallet()).totalPoints,1400);assert.equal((await f.wallet()).reservedPoints,1000);
 assert.equal((await f.bankRefund(refund.order)).order.status,'REFUNDED');assert.equal((await f.wallet()).totalPoints,400);assert.equal((await f.wallet()).reservedPoints,0);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.rewardAccess.grantId,ad.applied.session.grant.id);assert.equal((await f.quote(f.webtoon.episodes[2].id)).quote.access,'OWNED');
});

test('active-reader checks precede evidence replay; revoked accounts cannot receive or reproduce grants',async()=>{
 await enable();const started=await f.start(),proof=f.evidence(started);await db.query("update public.readers set status='BLOCKED' where auth_user_id=$1",[reader]);error(await f.applyEvidence(proof),'READER_REQUIRED',403);assert.equal(await count('op06_events'),0);await db.query("update public.readers set status='ACTIVE' where auth_user_id=$1",[reader]);await f.applyEvidence(proof);await db.query("update public.readers set status='BLOCKED' where auth_user_id=$1",[reader]);error(await f.applyEvidence(proof),'READER_REQUIRED',403);assert.equal(await count('op06_grants'),1);
});

test('per-user minute and Korean-day budgets include failed sessions but preserve exact retries and other readers',async()=>{
 await enable();let first;
 for(let i=0;i<5;i++){const requestId=uuid(),started=await f.start(undefined,'AD_REWARD',{requestId});if(!i)first={requestId,started};await f.applyEvidence(f.evidence(started,{outcome:'NO_FILL'}));}
 error(await f.start(),'RATE_LIMITED',429);assert.equal((await f.start(undefined,'AD_REWARD',{requestId:first.requestId})).replayed,true);assert.ok((await f.start(undefined,'AD_REWARD',{},otherReader)).session);
 await db.query("update commerce.op06_sessions set created_at=created_at-interval '2 minutes' where user_id=$1",[reader]);await f.rewardPolicy({dailyLimit:5});error(await f.start(),'RATE_LIMITED',429);
});

test('new evidence/policy/grant/receipt rows are immutable and expose SHA-256 provenance only',async()=>{
 await enable();const {proof}=await f.grantAd();for(const table of ['op06_policies','op06_events','op06_grants','op06_receipts','op06_audit']){await db.exec('savepoint imm');await assert.rejects(db.query('delete from commerce.'+table),/OP04_TEST_EVIDENCE_IMMUTABLE/);await db.exec('rollback to savepoint imm;release savepoint imm');}
 const event=(await db.query('select fingerprint,body_digest from commerce.op06_events')).rows[0];assert.match(event.fingerprint,/^[a-f0-9]{64}$/);assert.equal(event.body_digest,proof.bodyDigest);const sourceHash=createHash('sha256').update(f.originalBase.prosrc).digest('hex');assert.equal(sourceHash,'dd5ca9aba1a49cb1df8208b22764f61075cf99ffe6c7c0c473917f332bf8cde2');
});
