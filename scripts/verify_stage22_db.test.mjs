import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader} from './fixtures/stage22-db.mjs';
let f,db;before(async()=>{f=await setup();db=f.db;});after(async()=>{await db?.close();});
const count=async(table,w)=>(await db.query('select count(*) n from growth.'+table+' where work_id=$1',[w])).rows[0].n;
const later=days=>new Date(Date.now()+days*86400000).toISOString();
test('018 is repeatable, private, service-only, and never infers new consent',async()=>{
 await db.exec(sql);assert.equal((await f.call('preferences',{},reader)).measurementConsent,false);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_table_privilege($1,'growth.first_deliveries','select') ok",[role])).rows[0].ok,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.stage22_episode_content(uuid,bigint,boolean)','execute') ok",[role])).rows[0].ok,false);
 assert.equal((await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:false,measurementConsent:true})).error,'INVALID_PREFERENCES');
 await assert.rejects(db.exec("set webnovels.authoring_apply_verified='false';"+sql),/Verified/);await db.exec("rollback;set webnovels.authoring_apply_verified='true'");
});
test('first body marker uses public free version, is idempotent across episodes, and skips anonymous/self/nonconsent',async()=>{
 const w=await f.publish({episodes:2});await f.content(w.episodes[0],null);await f.content(w.episodes[0],f.users[1]);assert.equal(await count('first_deliveries',w.w),0);
 await f.consent();const r=await f.content(w.episodes[0]);assert.equal(r.episode.id,w.episodes[0]);await f.content(w.episodes[1]);await f.content(w.episodes[0]);
 const rows=(await db.query('select * from growth.first_deliveries where work_id=$1',[w.w])).rows;assert.equal(rows.length,1);assert.equal(rows[0].version_id,r.episode.versionId);
 const replacement=crypto.randomUUID();await db.query("insert into authoring.publication_versions(id,episode_id,work_id,title,content) values($1,$2,$3,'교체 공개본','수정 본문')",[replacement,w.episodes[0],w.w]);
 await db.query('update authoring.publication_heads set version_id=$1 where episode_id=$2',[replacement,w.episodes[0]]);
 assert.equal((await f.content(w.episodes[0])).episode.versionId,replacement);
 assert.equal((await db.query('select version_id from growth.first_deliveries where work_id=$1',[w.w])).rows[0].version_id,r.episode.versionId);
 await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:true,measurementConsent:true},reader);
 const own=await f.publish({author:reader});await f.content(own.episodes[0],reader);assert.equal(await count('first_deliveries',own.w),0);
 await db.query("update episodes set is_free=false,access_policy='PAID' where id=$1",[w.episodes[0]]);assert.equal((await f.content(w.episodes[0])).error,'EPISODE_NOT_FOUND');
});
test('receipts bind user/work/epoch/TTL and reject withdrawal, hidden works, and forged inputs',async()=>{
 const w=await f.publish();await f.consent();await f.consent(f.users[1]);
 const feed=await f.call('feed');const card=feed.works.find(x=>x.id===w.w);assert.ok(card.receiptId);assert.equal((await f.call('feed')).works.find(x=>x.id===w.w).receiptId,card.receiptId);
 assert.equal((await f.call('viewport',{receiptId:card.receiptId},f.users[1])).error,'RECEIPT_UNAVAILABLE');
 assert.equal((await f.call('viewport',{receiptId:'invalid'})).error,'INVALID_INPUT');
 assert.equal((await f.call('viewport',{receiptId:card.receiptId})).recorded,true);await f.call('viewport',{receiptId:card.receiptId});assert.equal(await count('first_touches',w.w),1);
 await f.consent(f.users[0],false);assert.equal(await count('delivery_receipts',w.w),0);assert.equal(await count('first_touches',w.w),0);
 assert.equal((await f.call('viewport',{receiptId:card.receiptId})).error,'MEASUREMENT_CONSENT_REQUIRED');await f.consent();
 assert.equal((await f.call('viewport',{receiptId:card.receiptId})).error,'RECEIPT_UNAVAILABLE');
 const newId=(await f.call('feed')).works.find(x=>x.id===w.w).receiptId;assert.notEqual(newId,card.receiptId);
 await db.query("update growth.delivery_receipts set created_at=created_at-interval '25 hours',expires_at=expires_at-interval '25 hours' where id=$1",[newId]);
 assert.equal((await f.call('viewport',{receiptId:newId})).error,'RECEIPT_UNAVAILABLE');
 await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w.w]);assert.equal((await f.call('referral',{workId:w.w,source:'SHARE'})).error,'WORK_NOT_FOUND');
});
test('mature conversion hides small samples and counts first body only within the prospective 24h window',async()=>{
 const w=await f.publish();for(const u of f.users){await f.consent(u);const card=(await f.call('feed',{},u)).works.find(x=>x.id===w.w);
  await f.call('viewport',{receiptId:card.receiptId},u);await f.call('referral',{workId:w.w,source:'SHARE'},u);await f.content(w.episodes[0],u);}
 const pending=await f.funnel(w.w,later(0.001));assert.equal(pending.channels.VIEWPORT.status,'PENDING');assert.equal(pending.channels.VIEWPORT.denominator,null);
 const ready=await f.funnel(w.w,later(2));assert.equal(ready.firstBodies,6);assert.equal(ready.channels.SHARE.denominator,6);assert.equal(ready.channels.VIEWPORT.converted,6);
 const variants=(await db.query('select growth.viewport_evidence($1) result',[later(2)])).rows[0].result;
 assert.ok(variants.some(v=>v.readerWorkPairs>=6&&v.firstBodyPairs>=6));assert.ok(!JSON.stringify(variants).includes(f.users[0]));
 await db.query("update growth.first_deliveries set created_at=created_at+interval '25 hours' where user_id=$1 and work_id=$2",[f.users[0],w.w]);assert.equal((await f.funnel(w.w,later(2))).channels.VIEWPORT.converted,5);
 await f.consent(f.users[0],false);await f.consent(f.users[1],false);const small=await f.funnel(w.w,later(2));assert.equal(small.channels.SHARE.status,'INSUFFICIENT');assert.equal(small.channels.SHARE.denominator,null);
 await db.query("update auth.users set banned_until=now()+interval '10 days' where id=$1",[f.users[2]]);assert.equal((await f.call('referral',{workId:w.w,source:'SHARE'},f.users[2])).error,'MEASUREMENT_CONSENT_REQUIRED');
 await db.query('update auth.users set banned_until=null where id=$1',[f.users[2]]);
 await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w.w]);assert.equal((await f.funnel(w.w,later(2))).channels.VIEWPORT.status,'EMPTY');
});
test('already-issued body is excluded from new attribution and withdrawal clears all new markers',async()=>{
 const w=await f.publish();await f.consent();await f.content(w.episodes[0]);await f.call('referral',{workId:w.w,source:'SHARE'});assert.equal(await count('first_touches',w.w),0);
 await f.call('save-preferences',{excludedGenres:[],frequency:'OFF',analyticsConsent:false});assert.equal(await count('first_deliveries',w.w),0);
 await f.consent();await f.call('referral',{workId:w.w,source:'SHARE'});assert.equal(await count('first_touches',w.w),1);
 assert.equal((await f.call('referral',{workId:w.w,source:'https://private.test?a=secret'})).error,'INVALID_INPUT');
 assert.equal((await f.call('referral',{workId:w.w,source:'SHARE',timestamp:'bad'})).error,'INVALID_INPUT');
});
test('sitemap partitions are stable, sparse bigint safe, and recheck free/type/current visibility',async()=>{
 const w=await f.publish();let bucket=String((BigInt(w.w)-1n)/1000n);assert.ok((await f.call('seo',{},null)).partitions.includes(bucket));
 assert.ok((await f.call('seo',{bucket},null)).items.some(x=>x.id===w.w));
 const wt=await f.webtoon();assert.equal((await f.call('seo',{workId:wt.w},null)).items.length,0);assert.equal((await f.call('seo',{workId:wt.w,webtoon:true},null)).items.length,1);
 await f.consent();assert.equal((await f.content(wt.episode)).error,'EPISODE_NOT_FOUND');assert.ok((await f.content(wt.episode,f.users[0],true)).episode.webtoon);
 const wtReceipt=(await f.call('feed',{webtoon:true})).works.find(x=>x.id===wt.w).receiptId;
 assert.equal((await f.call('viewport',{receiptId:wtReceipt})).error,'WORK_NOT_FOUND');
 assert.equal((await db.query('select viewport_at from growth.delivery_receipts where id=$1',[wtReceipt])).rows[0].viewport_at,null);
 assert.equal((await f.call('referral',{workId:wt.w,source:'SHARE'})).error,'WORK_NOT_FOUND');
 assert.equal((await f.call('seo',{bucket:'9223372036854776'},null)).error,'INVALID_INPUT');
 assert.equal((await f.call('seo',{workId:w.w,bucket},null)).error,'INVALID_INPUT');
 await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w.w]);assert.equal((await f.call('seo',{workId:w.w},null)).items.length,0);
});
test('cleanup is bounded and preserves first markers; role-scoped reports never return user IDs',async()=>{
 const w=await f.publish();await f.consent();await f.call('referral',{workId:w.w,source:'SHARE'});await f.content(w.episodes[0]);
 await db.query("update growth.first_touches set created_at=now()-interval '91 days' where work_id=$1",[w.w]);
 const r=(await db.query('select public.prune_growth_measurements(1) result')).rows[0].result;assert.ok(r.touchesDeleted<=1);assert.equal(r.firstMarkersDeleted,0);assert.equal(await count('first_deliveries',w.w),1);
 await assert.rejects(db.query('select public.prune_growth_measurements(0)'),/Invalid cleanup/);
 assert.equal((await f.call('report',{workId:w.w},reader)).error,'WORK_NOT_FOUND');
 const report=await f.call('report',{workId:w.w},admin);assert.ok(report.funnel);assert.ok(!JSON.stringify(report).includes(f.users[0]));
 assert.ok((await f.call('admin',{},admin)).works.find(x=>x.workId===w.w).metrics.funnel);
 await db.query("select public.stage21_growth($1,'save-preferences',$2)",[f.users[0],JSON.stringify({excludedGenres:[],frequency:'OFF',analyticsConsent:false})]);
 assert.equal(await count('first_deliveries',w.w),0);assert.equal((await f.call('preferences')).measurementConsent,false);
});
test('1,001 public works and bigint maximum span stable partitions without truncation or overflow',async()=>{
 // Bulk synthetic fixtures use the same reviewed schema; no production writes or legacy import.
 await db.exec(`insert into works(id,author_id,status,rating,title,description,genre,published_at)
  select id,1,'PUBLISHED','ALL','분할 시험','소개',array['판타지'],now() from
   (select generate_series(100000::bigint,101000::bigint) id union all select 9223372036854775807::bigint) s;
  insert into authoring.work_state(work_id,author_id,visibility,rating_confirmed,ai_confirmed)
   select id,1,'PUBLIC',true,true from works where id>=100000;
  insert into episodes(id,work_id,episode_number,title,content,image_urls,status)
   select id,id,1,'시험','본문','[]','PUBLISHED' from works where id>=100000;
  insert into authoring.publication_versions(episode_id,work_id,title,content)
   select id,id,'시험','본문' from works where id>=100000;
  insert into authoring.publication_heads(episode_id,version_id)
   select episode_id,id from authoring.publication_versions where work_id>=100000;`);
 const index=(await f.call('seo',{},null)).partitions;assert.ok(index.includes('9223372036854775'));
 const ids=[];for(const bucket of ['99','100','9223372036854775'])ids.push(...(await f.call('seo',{bucket},null)).items.map(x=>x.id));
 assert.equal(ids.length,1002);assert.equal(new Set(ids).size,1002);assert.ok(ids.includes('9223372036854775807'));
 assert.equal((await f.call('seo',{bucket:'100'},null)).items.length,1000);
 await db.exec("update authoring.work_state set visibility='PRIVATE' where work_id=100001");
 assert.equal((await f.call('seo',{bucket:'100'},null)).items.length,999);
 await f.consent();
 // Fill the per-account storage bound with synthetic existing receipts; the feed still works.
 const current=(await f.call('preferences')).measurementSince;
 await db.query(`insert into growth.delivery_receipts(user_id,work_id,epoch,kst_day,experiment,variant)
  select $1,id,$2, current_date,'BOUND','NEWCOMER' from works where id>=100000 order by id limit 200
  on conflict do nothing`,[f.users[0],current]);
 const before=(await db.query('select count(*) n from growth.delivery_receipts where user_id=$1',[f.users[0]])).rows[0].n;
 const bounded=await f.call('feed');assert.ok(bounded.works.length>0);assert.ok(bounded.works.every(x=>x.receiptId===null));
 assert.equal((await db.query('select count(*) n from growth.delivery_receipts where user_id=$1',[f.users[0]])).rows[0].n,before);
 await db.query(`insert into growth.first_touches(user_id,work_id,epoch,kind,experiment,variant)
  select $1,100002+i,$2,'VIEWPORT','bounded-'||i,'CONTROL' from generate_series(1,31) i`,[f.users[0],current]);
 const evidence=(await db.query('select growth.viewport_evidence($1) result',[later(2)])).rows[0].result;
 assert.ok(new Set(evidence.map(x=>x.version)).size<=30);assert.ok(evidence.every(x=>x.status!=='READY'||x.readerWorkPairs!==null));
});
