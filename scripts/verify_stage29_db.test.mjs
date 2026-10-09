import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader,limited,draft} from './fixtures/stage29-db.mjs';
const key='cccccccc-cccc-4ccc-8ccc-cccccccccccc',key2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const detail=s=>s.review('recovery-detail',{recoveryId:s.request.id});
const source=(s,d,kind='manuscript')=>({recoveryId:s.request.id,requestId:key,reason:'제출 자료 검토',contextDigest:d.contextDigest,kind});
const decision=(s,d,extra={})=>({recoveryId:s.request.id,requestId:key2,reason:'원본 권리 자료 보완 필요',contextDigest:d.contextDigest,revision:d.reviewRevision,
 decision:'HOLD',evidence:'권리 자료 참조 대기',accessId:null,rightsChecked:false,ratingChecked:false,aiChecked:false,...extra});
async function preserved(s){return (await s.db.query(`select jsonb_build_object('episodes',(select jsonb_agg(to_jsonb(x) order by id) from episodes x),
 'drafts',(select jsonb_agg(to_jsonb(x) order by id) from authoring.drafts x),'revisions',(select jsonb_agg(to_jsonb(x) order by revision) from authoring.draft_revisions x),
 'requests',(select jsonb_agg(to_jsonb(x) order by id) from authoring.recovery_requests x),'files',(select jsonb_agg(to_jsonb(x) order by id) from authoring.files x),
 'heads',(select jsonb_agg(to_jsonb(x)) from authoring.publication_heads x),'state',(select jsonb_agg(to_jsonb(x) order by work_id) from authoring.work_state x)) value`)).rows[0].value;}
test('queue/detail are metadata-only, owner feedback is private, existing roles never confer source access',async()=>{
 const s=await setup();try{
  const list=await s.review('recovery-list',{},limited),d=await detail(s);assert.equal(list.requests.length,1);assert.equal(d.eligible,true);assert.equal(d.reviewRevision,'0');
  for(const value of [list,d])for(const secret of ['제출 당시 비공개 원고','Original body','object_key','target_snapshot',admin])assert.ok(!JSON.stringify(value).includes(secret));
  assert.equal((await s.review('recovery-source',source(s,d),limited)).status,403);
  assert.equal((await s.review('recovery-list',{},reader)).status,403);
  assert.equal((await s.feedback(reader)).status,404);assert.equal((await s.feedback(admin,'20')).status,404);
  assert.equal((await s.review('recovery-list',{offset:'100001'})).status,400);
  assert.equal((await s.review('recovery-detail',{recoveryId:s.request.id,content:'x'})).status,400);
 }finally{await s.db.close();}
});
test('source reconstructs immutable submitted revision after later edits; audit and receipts contain metadata only',async()=>{
 const s=await setup();try{
  const d=await detail(s),payload=source(s,d);
  await s.rpc('creator_drafts',[admin,'save','10',draft,JSON.stringify({expectedRevision:'1',title:'후속 수정',content:'나중 편집본',authorComment:''}),key2,'0']);
  const before=await preserved(s),r=await s.review('recovery-source',payload);assert.equal(r.content,'제출 당시 비공개 원고 😀');assert.equal(r.revision,'1');
  assert.deepEqual(await s.review('recovery-source',payload),r);assert.deepEqual(await preserved(s),before);
  const audit=(await s.db.query('select detail from authoring.workflow_events')).rows;const receipts=(await s.db.query('select result from authoring.recovery_review_receipts')).rows;
  assert.equal(audit.length,1);assert.equal(receipts.length,1);for(const x of [audit,receipts])for(const secret of ['제출 당시','나중 편집','object_key','content','bucket'])assert.ok(!JSON.stringify(x).includes(secret));
  assert.equal((await s.review('recovery-source',{...payload,reason:'다른 사유'})).error,'REQUEST_CONFLICT');
  await s.db.exec("update admin_users set role='SUB_ADMIN',permissions='[\"CONTENT_REVIEW\"]' where auth_user_id='"+admin+"'");assert.equal((await s.review('recovery-source',payload)).status,403);
 }finally{await s.db.close();}
});
test('append-only CAS decisions replay exactly, report to the original owner, and preserve every original row',async()=>{
 const s=await setup();try{const d=await detail(s),p=decision(s,d),before=await preserved(s);const result=await s.review('recovery-decide',p,limited);
  assert.equal(result.status,'HOLD');assert.equal(result.revision,'1');assert.deepEqual(await s.review('recovery-decide',p,limited),result);
  assert.equal((await s.review('recovery-decide',{...p,reason:'다른 결정'},limited)).error,'REQUEST_CONFLICT');
  assert.equal((await s.review('recovery-decide',{...p,requestId:key},limited)).error,'RECOVERY_REVIEW_CONFLICT');
  const feedback=await s.feedback();assert.equal(feedback.reviews[s.request.id].status,'HOLD');assert.equal(feedback.reviews[s.request.id].reason,p.reason);
  assert.equal((await s.feedback(admin,'10',s.request.id)).reviews[s.request.id].status,'HOLD');assert.deepEqual((await s.feedback(reader,'20',s.request.id)).reviews,undefined);
  assert.equal((await detail(s)).history.length,1);assert.deepEqual(await preserved(s),before);assert.equal((await s.review('recovery-list')).requests[0].review.status,'HOLD');
  for(let n=0;n<52;n++)await s.rpc('creator_draft_recovery',[admin,'submit','10',draft,JSON.stringify(s.submission),crypto.randomUUID(),'0']);
  const page=await s.review('recovery-list',{offset:'0'}),next=await s.review('recovery-list',{offset:'50'});assert.equal(page.requests.length,50);assert.equal(page.hasMore,true);assert.equal(next.requests.length,3);assert.equal(next.hasMore,false);
  assert.ok(!(s.request.id in (await s.feedback()).reviews));assert.equal((await s.feedback(admin,'10',s.request.id)).reviews[s.request.id].status,'HOLD');
  for(const table of ['recovery_review_events','recovery_source_access','recovery_review_receipts']){if(table==='recovery_source_access')await s.review('recovery-source',source(s,d));
   await assert.rejects(s.db.exec('delete from authoring.'+table),/Immutable/);}
  await s.db.exec("update admin_users set permissions='[]' where auth_user_id='"+limited+"'");assert.equal((await s.review('recovery-decide',p,limited)).status,403);
 }finally{await s.db.close();}
});
test('READY requires current SUPER_ADMIN, audited submitted manuscript and explicit evidence; it never publishes',async()=>{
 const s=await setup();try{const d=await detail(s),p=decision(s,d,{decision:'READY_FOR_RESTORE_REVIEW',rightsChecked:true,ratingChecked:true,aiChecked:true,evidence:'외부 권리 자료의 검토 참조'}),before=await preserved(s);
  assert.equal((await s.review('recovery-decide',p,limited)).status,403);assert.equal((await s.review('recovery-decide',p)).error,'RECOVERY_EVIDENCE_REQUIRED');
  const access=await s.review('recovery-source',source(s,d));p.accessId=access.accessId;
  assert.equal((await s.review('recovery-decide',{...p,aiChecked:false})).error,'RECOVERY_EVIDENCE_REQUIRED');
  const ready=await s.review('recovery-decide',p);assert.equal(ready.status,'READY_FOR_RESTORE_REVIEW');assert.deepEqual(await preserved(s),before);
  await s.db.exec("update admin_users set role='SUB_ADMIN',permissions='[\"CONTENT_REVIEW\"]' where auth_user_id='"+admin+"'");assert.equal((await s.review('recovery-decide',p)).status,403);
 }finally{await s.db.close();}
});
test('target, file checksum/size, commit lineage and owner/account changes block source reads even with a fresh digest',async()=>{
 const s=await setup();try{const initial=await detail(s);await s.db.exec('begin');for(const [change] of [
  ["update episodes set content='변경' where id=100","update episodes set content='Original body' where id=100"],
  ["update authoring.files set sha256=repeat('b',64)","update authoring.files set sha256=repeat('a',64)"],
  ['update authoring.files set byte_size=11','update authoring.files set byte_size=10'],
  ["update authoring.file_jobs set state='PREPARED'","update authoring.file_jobs set state='COMMITTED'"],
  ["update authors set auth_user_id=null where id=1","update authors set auth_user_id='"+admin+"' where id=1"],
  ["update authors set status='SUSPENDED' where id=1","update authors set status='APPROVED' where id=1"]]){
   await s.db.exec('savepoint mutation');await s.db.exec(change);const d=await detail(s);assert.equal(d.eligible,false);assert.equal((await s.review('recovery-source',source(s,initial))).error,'RECOVERY_CONTEXT_CHANGED');
   assert.equal((await s.review('recovery-source',source(s,d))).error,'RECOVERY_SOURCE_UNAVAILABLE');await s.db.exec('rollback to mutation;release mutation');
  }
  await s.db.exec('commit');
  const d=await detail(s),r=await s.review('recovery-source',source(s,d,'original'));assert.equal(r.file.bucket,'authoring-originals');assert.equal(r.file.size,'10');
  await s.db.exec('delete from authoring.revision_files where false');
  await s.db.exec("update auth.users set banned_until=now()+interval '1 day' where id='"+admin+"'");assert.equal((await s.review('recovery-source',source(s,d,'original'))).status,403);assert.equal((await s.feedback()).status,403);
 }finally{await s.db.close();}
});
test('all private tables and helpers are closed to direct clients and service_role; migration requires review',async()=>{
 const s=await setup();try{for(const role of ['anon','authenticated','service_role']){
  await s.db.exec('set role '+role);for(const table of ['recovery_review_events','recovery_source_access','recovery_review_receipts'])await assert.rejects(s.db.exec('select * from authoring.'+table));
  if(role!=='service_role'){await assert.rejects(s.review('recovery-list'));await assert.rejects(s.feedback());}else assert.equal((await s.review('recovery-list')).requests.length,1);
  await s.db.exec('reset role');
 }
 const sql=await readFile('database/authoring/020_admin_recovery_review.sql','utf8');await s.db.exec(sql);await s.db.exec("set webnovels.authoring_apply_verified='false'");await assert.rejects(s.db.exec(sql),/prerequisites/);await s.db.exec('rollback');
 for(const data of [{},{recoveryId:'1'},{...decision(s,await detail(s)),revision:'9223372036854775808'},{...decision(s,await detail(s)),rightsChecked:'true'}])assert.equal((await s.review('recovery-decide',data)).status,400);
 assert.equal((await s.review('bogus')).status,400);
 }finally{await s.db.close();}
});
