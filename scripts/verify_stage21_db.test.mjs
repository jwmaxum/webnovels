import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader,limited,config} from './fixtures/stage21-db.mjs';
let f,db;
before(async()=>{f=await setup();db=f.db;});after(async()=>db?.close());
test('additive repeatable migration preserves content and closes direct roles, with no policy seed',async()=>{
 const n=(await db.query('select count(*) n from authoring.draft_revisions')).rows[0].n;await db.exec(sql);
 assert.equal((await db.query('select count(*) n from authoring.draft_revisions')).rows[0].n,n);
 assert.equal((await db.query('select count(*) n from growth.experiments')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);
  await assert.rejects(db.query('select * from growth.preferences'));
  if(role!=='service_role')await assert.rejects(f.call('preferences'));else assert.equal((await f.call('preferences')).analyticsConsent,false);
  await db.exec('reset role');}
});
test('author self, banned readers and pre-consent activity cannot manufacture a cohort or favorite count',async()=>{
 const w=await f.publish({author:reader});await db.query("update authoring.publication_heads set published_at='2026-01-01Z' where episode_id=$1",[w.episodes[0]]);
 await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:true});await db.query("update growth.preferences set metrics_since='2026-01-01Z' where user_id=$1",[reader]);
 for(const u of [reader,...f.users.slice(0,5)]){await f.event(u,w.w,w.episodes[0],'2026-02-01T12:00Z');await db.query("insert into authoring.reader_favorites(user_id,work_id,created_at) values($1,$2,'2026-02-01Z')",[u,w.w]);}
 assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.uniqueReaders,5);assert.equal((await f.metrics(w.w,'2026-02-02Z')).favoritesCurrent,5);
 await db.query("update auth.users set banned_until='2030-01-01Z' where id=$1",[f.users[0]]);assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.status,'INSUFFICIENT');await db.query('update auth.users set banned_until=null where id=$1',[f.users[0]]);
 await db.query("update growth.preferences set metrics_since='2026-02-02Z' where user_id=$1",[f.users[0]]);assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.uniqueReaders,null);await db.query("update growth.preferences set metrics_since='2026-01-01Z' where user_id=$1",[f.users[0]]);
 await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:false});
});
test('consent begins prospectively, reset preserves reading/favorites/consent; withdrawal deletes card logs',async()=>{
 const w=await f.publish();let p=await f.call('preferences');assert.equal(p.analyticsConsent,false);
 p=await f.call('save-preferences',{excludedGenres:['판타지'],frequency:'WEEKLY',analyticsConsent:true});assert.ok(p.metricsSince);
 await f.call('feed',{webtoon:false});
 assert.equal((await db.query('select count(*) n from growth.served_cards where user_id=$1',[reader])).rows[0].n,0);
 await f.call('reset');assert.equal((await f.call('preferences')).analyticsConsent,true);
 await f.call('feed',{webtoon:false});assert.equal((await db.query('select count(*) n from growth.served_cards where user_id=$1',[reader])).rows[0].n,1);
 await f.call('feed',{webtoon:false});assert.equal((await db.query('select count(*) n from growth.served_cards where user_id=$1',[reader])).rows[0].n,1);
 await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:false});assert.equal((await f.call('preferences')).metricsSince,null);
 assert.equal((await db.query('select count(*) n from growth.served_cards where user_id=$1',[reader])).rows[0].n,0);
 assert.ok((await f.call('seo',{webtoon:false},null)).items.some(x=>x.id===w.w));
 assert.equal((await f.call('report',{workId:w.w},reader)).error,'WORK_NOT_FOUND');
 assert.equal((await f.call('admin',{},limited)).error,'ADMIN_FORBIDDEN');
});
test('KST exact D7/D28 includes only fully mature cohorts; duplicate progress does not double samples',async()=>{
 const w=await f.publish();await db.query("update authoring.publication_heads set published_at='2026-01-01Z' where episode_id in (select id from public.episodes where work_id=$1)",[w.w]);
 for(const u of f.users.slice(0,5)){
  await f.event(u,w.w,w.episodes[0],'2026-01-01T15:00:00Z');await f.event(u,w.w,w.episodes[0],'2026-01-01T15:10:00Z','COMPLETE');
  await f.event(u,w.w,w.episodes[0],'2026-01-08T15:00:00Z');await f.event(u,w.w,w.episodes[0],'2026-01-29T15:00:00Z');
 }
 const before=await f.metrics(w.w,'2026-01-09T14:59:59Z');assert.equal(before.d7.status,'PENDING');assert.equal(before.d7.rate,null);
 const mature=await f.metrics(w.w,'2026-01-09T15:00:00Z');assert.equal(mature.d7.denominator,5);assert.equal(mature.d7.rate,1);assert.equal(mature.d28.status,'PENDING');
 const d28=await f.metrics(w.w,'2026-01-30T15:00:00Z');assert.equal(d28.d28.rate,1);
 assert.equal(mature.reading.readerEpisodePairs,5);assert.equal(mature.reading.completionProxy,1);
 await db.query('update growth.preferences set consent=false where user_id=$1',[f.users[0]]);
 assert.equal((await f.metrics(w.w,'2026-01-30T15:00:00Z')).d28.status,'INSUFFICIENT');
 await db.query('update growth.preferences set consent=true where user_id=$1',[f.users[0]]);
});
test('verified eligibility, current public heads, self exclusion and tiny samples enforced',async()=>{
 const w=await f.publish();await db.query("update authoring.publication_heads set published_at='2026-01-01Z' where episode_id in (select id from public.episodes where work_id=$1)",[w.w]);
 for(const u of f.users)await f.event(u,w.w,w.episodes[0],'2026-02-01T12:00:00Z','COMPLETE');
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[f.users[0]]);
 assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.uniqueReaders,5);
 await db.query('update auth.users set is_anonymous=true where id=$1',[f.users[1]]);
 assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.uniqueReaders,null);
 await db.query('update auth.users set email_confirmed_at=now(),is_anonymous=false where id=any($1::uuid[])',[f.users]);
 await db.query("update readers set status='SUSPENDED' where auth_user_id=$1",[f.users[0]]);
 assert.equal((await f.metrics(w.w,'2026-02-02Z')).reading.uniqueReaders,5);
 await db.query("update readers set status='ACTIVE' where auth_user_id=$1",[f.users[0]]);
 await db.query("update episodes set is_free=false,access_policy='PAID' where id=$1",[w.episodes[0]]);
 const hidden=await f.metrics(w.w,'2026-02-02Z');assert.equal(hidden.episodes,0);assert.equal(hidden.reading.status,'EMPTY');
});
test('version immutable hypothesis, idempotent evaluations/outbox and no automatic tier/push',async()=>{
 const w=await f.publish();await db.query("update authoring.publication_heads set published_at='2026-01-01Z' where episode_id in (select id from public.episodes where work_id=$1)",[w.w]);
 assert.equal((await f.call('configure',{version:'fixture-v1',config},admin)).kind,'HYPOTHESIS');
 assert.equal((await f.call('configure',{version:'fixture-v1',config:{...config,minReaders:6}},admin)).error,'POLICY_VERSION_CONFLICT');
 for(const u of f.users){await f.event(u,w.w,w.episodes[0],'2026-02-01T12:00:00Z','COMPLETE');await db.query("insert into authoring.reader_favorites(user_id,work_id,created_at) values($1,$2,'2026-02-01Z')",[u,w.w]);}
 const run=async()=>(await db.query("select growth.evaluate($1,'fixture-v1','2026-02-02') result",[w.w])).rows[0].result;
 const a=await run(),b=await run();assert.deepEqual(a,b);assert.equal(a.actualPromotion,false);assert.equal(a.notificationSent,false);
 assert.equal(a.decision,'HYPOTHESIS_MATCH_MAPPING_REQUIRED');assert.equal(a.previousTier,'UNCLASSIFIED');assert.ok(a.heads[0].versionId);
 assert.equal((await db.query('select count(*) n from growth.outbox where work_id=$1',[w.w])).rows[0].n,1);
 for(const t of ['experiments','evaluations','outbox'])await assert.rejects(db.exec('delete from growth.'+t),/immutable/i);
 const bad={...config};delete bad.minReaders;bad.unknown=3;assert.equal((await f.call('configure',{version:'bad',config:bad},admin)).error,'INVALID_POLICY');
});
test('SEO excludes private/adult/paid-only and recommendations cap authors and respect genres',async()=>{
 const w=await f.publish({title:'공개'});const seo=()=>f.call('seo',{webtoon:false},null);
 assert.ok((await seo()).items.some(x=>x.id===w.w));
 await db.query("update works set rating='AGE_19' where id=$1",[w.w]);assert.ok(!(await seo()).items.some(x=>x.id===w.w));
 await db.query("update works set rating='ALL',genre=array['성인'] where id=$1",[w.w]);assert.ok(!(await seo()).items.some(x=>x.id===w.w));
 await db.query("update works set genre=array['판타지'] where id=$1",[w.w]);await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w.w]);assert.ok(!(await seo()).items.some(x=>x.id===w.w));
 const feed=await f.call('feed',{webtoon:false},null);assert.ok(feed.works.length<=8);assert.equal(new Set(feed.works.map(x=>x.author_id)).size,feed.works.length);
});
test('publication supply separates a new episode from head replacement and preserves immutable baseline',async()=>{
 const w=await f.publish({episodes:2});const m=await f.metrics(w.w,new Date(Date.now()+1000).toISOString());
 assert.equal(m.serialSupply.newEpisodes,2);assert.equal(m.serialSupply.replacedHeads,0);
 const head=(await db.query('select version_id from authoring.publication_heads where episode_id=$1',[w.episodes[0]])).rows[0].version_id;
 await db.query('update authoring.publication_heads set version_id=$1 where episode_id=$2',[head,w.episodes[0]]);
 assert.equal((await f.metrics(w.w,new Date(Date.now()+1000).toISOString())).serialSupply.newEpisodes,2);
 await assert.rejects(db.query('delete from growth.publication_activity where work_id=$1',[w.w]),/immutable/i);
});
test('bounded daily batch resumes remaining works and expires only old card logs',async()=>{
 const active={...config,startsAt:new Date(Date.now()-30*86400000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 assert.equal((await f.call('configure',{version:'batch-v1',config:active},admin)).kind,'HYPOTHESIS');
 const works=[];for(let i=0;i<21;i++)works.push((await f.publish({title:'배치 '+i})).w);
 await db.query("update works set published_at=(now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul' - interval '1 day' where id=any($1::bigint[])",[works]);
 await db.query("update authoring.publication_heads set published_at=((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')-interval '1 day' where episode_id in (select id from episodes where work_id=any($1::bigint[]))",[works]);
 await db.query("insert into growth.served_cards(user_id,work_id,kst_day,variant,created_at) values($1,$2,current_date-91,'NEWCOMER',now()-interval '91 days')",[f.users[0],works[0]]);
 const batch=async()=>(await db.query('select public.run_growth_evaluations(20) result')).rows[0].result;
 const a=await batch(),b=await batch(),c=await batch();assert.equal(a.evaluated,20);assert.equal(b.evaluated,1);assert.equal(c.evaluated,0);assert.equal(a.removedExpiredCards,1);
 assert.equal((await db.query("select count(*) n from growth.outbox where version='batch-v1'")).rows[0].n,21);
 assert.ok((await f.call('admin',{},admin)).works.length<=50);
 await assert.rejects(db.query('select public.run_growth_evaluations(21)'),/Invalid batch limit/);
});
test('decisions keep immutable evidence and revoked admin cannot replay previous writes',async()=>{
 const data={version:'fixture-v1',decision:'CHANGE',reason:'표본과 재방문 기간을 추가 관찰합니다.',evidence:{sampleSize:6,observedDays:28,costKrw:0,retentionSummary:'합성 검증이며 실제 실험이 아닙니다.',supplySummary:'실제 신인 공급 검증이 남아 있습니다.',guardrailSummary:'부정 트래픽과 장르 편향 인수가 남아 있습니다.'}};
 assert.equal((await f.call('decide',data,admin)).decision,'CHANGE');assert.equal((await f.call('decide',data,admin)).decision,'CHANGE');
 assert.equal((await f.call('decide',{...data,decision:'KEEP'},admin)).error,'DECISION_CONFLICT');
 await db.query('update admin_users set is_active=false where auth_user_id=$1',[admin]);assert.equal((await f.call('decide',data,admin)).error,'ACCOUNT_INACTIVE');
 await db.query('update admin_users set is_active=true where auth_user_id=$1',[admin]);
});
test('webtoon manifest requires a separate policy and never inherits the novel character threshold',async()=>{
 const w=await f.webtoon(),m=await f.metrics(w.w,new Date(Date.now()+1000).toISOString());assert.equal(m.episodes,1);assert.equal(m.novelCharactersWithSpaces,0);assert.equal(m.webtoonAssets,1);
 assert.ok(!(await f.call('seo',{webtoon:false},null)).items.some(x=>x.id===w.w));assert.ok((await f.call('seo',{webtoon:true},null)).items.some(x=>x.id===w.w));
 const current={...config,type:'WEBTOON',minCharacters:0,startsAt:new Date(Date.now()-86400000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()};
 assert.equal((await f.call('configure',{version:'webtoon-v1',config:current},admin)).kind,'HYPOTHESIS');
 const day=(await db.query("select (now() at time zone 'Asia/Seoul')::date+1 d")).rows[0].d;
 const r=(await db.query('select growth.evaluate($1,$2,$3) result',[w.w,'webtoon-v1',day])).rows[0].result;assert.equal(r.policy.type,'WEBTOON');assert.equal(r.actualPromotion,false);
});
