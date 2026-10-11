import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,lstat} from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {setup,submit,refresh,ready,admin,draft,targetRef} from './fixtures/stage31-restore.mjs';
import {privateSentinel} from './fixtures/stage30-evidence.mjs';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {buildRecoveryPacket,prepareRecoveryPackage,recoveryDecisionTemplate} from './lib/recovery-evidence.mjs';
import {sha} from './lib/launch-content-review.mjs';
import {restoreTargetRef,submittedRestoreSql,executeIsolatedCandidate,rehearseSubmittedRestore,writeSubmittedCandidate,checkSubmittedCandidate} from './lib/submitted-recovery.mjs';
import {runSubmittedRestore} from './prepare_submitted_restore.mjs';
const rows=async db=>{
 const tables=(await db.query("select table_schema schema,table_name name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','authoring','auth','storage','launch_recovery') order by 1,2")).rows;
 for(const t of tables)t.rows=(await db.query('select to_jsonb(r)::text row from "'+t.schema+'"."'+t.name+'" r')).rows.map(r=>r.row).sort();return tables;
};
const candidate=s=>submittedRestoreSql(s.db,s.verified,s.packet,s.decisions,s.directory,targetRef);
test('one transaction restores all three body paths and archives originals; every other field and row is preserved',async()=>{
 const s=await setup();try{
  const c=await rehearseSubmittedRestore(s.db,s.verified,s.packet,s.decisions,s.directory,targetRef);
  const e=(await s.db.query('select e.content,c.content protected,a.text_content,a.content_version from episodes e join secure_episode_contents c on c.episode_id=e.id join episode_contents a on a.episode_id=e.id where e.id=100')).rows[0];
  assert.equal(e.content,s.packet.entries.find(e=>e.requestId===s.request.id).submitted.content);assert.equal(e.protected,e.content);assert.equal(e.text_content,e.content);assert.equal(e.content_version,7);
  const h=(await s.db.query('select before_data,after_data,submitted,imported from launch_recovery.submitted_restore_history')).rows[0];
  assert.equal(h.before_data.alternate[0].text_content,'별도 기존 본문');assert.equal(h.after_data.alternate[0].text_content,e.content);
  assert.equal(c.report.allOriginalRowsAccountedFor,true);assert.equal(c.report.privateImmutableHistory,true);assert.equal(c.report.replayRejected,true);assert.equal(c.report.updateDeleteTruncateRejected,true);
  assert.equal(c.report.productionChanged,false);assert.equal(c.report.hostedRestoreAccepted,false);assert.equal(c.report.freeCutoverAccepted,false);assert.equal(c.report.unresolved,1);
  for(const value of [privateSentinel,admin,s.request.id,e.content])assert.ok(!JSON.stringify(c.report).includes(value));
  assert.ok(!c.sql.includes(privateSentinel));
 }finally{await s.db.close();}
});
test('source/target, unselected rows, new/deleted rows and tables all reject stale whole-row CAS without mutation',async()=>{
 const s=await setup();try{const c=await candidate(s);
  for(const sql of ["update works set title='changed' where id=10","update storage.buckets set name='changed' where id='existing'",
   "update episode_contents set text_content='concurrent' where episode_id=100","delete from public.episode_contents where episode_id=100",
   "insert into public.episodes(id,work_id,episode_number,title,content,status) values(9999,10,88,'new','new','PUBLISHED')","create table public.extra_source(id int)","update auth.users set encrypted_password='changed'"]){
   await s.db.exec('begin');await s.db.exec(sql);const before=await rows(s.db);
   await assert.rejects(executeIsolatedCandidate(s.db,c,targetRef),/SUBMITTED_RESTORE_(ROWS_CHANGED|TABLE_SET_CHANGED)/);
   // executeIsolatedCandidate rolls back its entire transaction, including the test's injected change.
   assert.notDeepEqual(await rows(s.db),before);assert.deepEqual(await rows(s.db),s.verified.snapshot.tables.map(t=>({schema:t.schema,name:t.name,rows:[...t.rows].sort()})));
  }
 }finally{await s.db.close();}
});
test('latest HOLD and author/admin/Auth revocation invalidate the package and SQL candidate',async()=>{
 const s=await setup();try{const c=await candidate(s);
  await ready(s,'HOLD');const before=await rows(s.db);await assert.rejects(candidate(s),/CURRENT_PACKET_CHANGED/);await assert.rejects(executeIsolatedCandidate(s.db,c,targetRef),/ROWS_CHANGED/);assert.deepEqual(await rows(s.db),before);
  await ready(s);await refresh(s);
  for(const change of ["update authors set status='SUSPENDED' where id=1","update admin_users set role='SUB_ADMIN' where auth_user_id='"+admin+"'","update auth.users set banned_until='2099-01-01' where id='"+admin+"'"]){
   const c=await candidate(s),before=await rows(s.db);await s.db.exec('begin');await s.db.exec(change);
   await assert.rejects(candidate(s),/CURRENT_PACKET_CHANGED/);await assert.rejects(executeIsolatedCandidate(s.db,c,targetRef),/ROWS_CHANGED/);
   assert.deepEqual(await rows(s.db),before);
  }
 }finally{await s.db.close();}
});
test('mid-update and post-update side effects roll back original bodies, archive and additive DDL',async()=>{
 for(const sabotage of [
  "create function public.fail_restore_test() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_MID_FAILURE';end $$;create trigger fail_restore_test before update on public.secure_episode_contents for each row execute function public.fail_restore_test()",
  "create function public.fail_restore_test() returns trigger language plpgsql as $$ begin update public.works set title='side effect' where id=10;return new;end $$;create trigger fail_restore_test after update on public.episodes for each row execute function public.fail_restore_test()"
 ]){const s=await setup();try{const c=await candidate(s);await s.db.exec(sabotage);const before=await rows(s.db);
   await assert.rejects(executeIsolatedCandidate(s.db,c,targetRef),/SYNTHETIC_MID_FAILURE|SUBMITTED_RESTORE_ROWS_CHANGED/);assert.deepEqual(await rows(s.db),before);
   assert.equal((await s.db.query("select to_regclass('launch_recovery.submitted_restore_history') t")).rows[0].t,null);
  }finally{await s.db.close();}}
});
test('quoted/backslash/Korean body and bigint IDs stay exact; submitted revision differs from imported and current drafts',async()=>{
 const s=await setup();try{const id='9007199254740993',content="한글 ' 따옴표 \\ 경로\n😀 $sql$ 본문";
  await s.db.query("insert into episodes(id,work_id,episode_number,title,content,status) values($1,10,99,'기존 제목','기존 본문','PUBLISHED')",[id]);
  await s.db.query("update secure_episode_contents set content='기존 보호 본문' where episode_id=$1",[id]);
  await s.db.query("insert into episode_contents values($1,'기존 대체 본문',1,null)",[id]);
  await s.rpc('creator_drafts',[admin,'save','10',draft,JSON.stringify({expectedRevision:'1',title:'제출 제목',content,authorComment:'메모'}),crypto.randomUUID(),'0']);
  await submit(s,id,'2');await s.rpc('creator_drafts',[admin,'save','10',draft,JSON.stringify({expectedRevision:'2',title:'새 편집',content:'최신 초안은 보존',authorComment:''}),crypto.randomUUID(),'0']);await refresh(s);
  const c=await rehearseSubmittedRestore(s.db,s.verified,s.packet,s.decisions,s.directory,targetRef);
  const h=(await s.db.query('select episode_id::text id,before_data::text before,after_data::text after,submitted,imported from launch_recovery.submitted_restore_history')).rows[0];
  assert.equal(h.id,id);assert.ok(h.before.includes(id));assert.ok(h.after.includes(id));assert.equal(h.submitted.content,content);assert.notEqual(h.imported.content,content);
  assert.equal((await s.db.query('select content from episodes where id=$1',[id])).rows[0].content,content);assert.equal(c.report.publicationChanged,false);
 }finally{await s.db.close();}
});
test('private evidence bytes, empty selections, operator target guards and output checks fail closed',async()=>{
 const s=await setup();try{
  for(const target of [s.packet.projectRef,'bad','https://project.example'])assert.throws(()=>restoreTargetRef(s.packet.projectRef,target),/SEPARATE_TARGET/);
  const c=await candidate(s),before=await rows(s.db);assert.equal(c.report.status,'TRANSACTION_CANDIDATE_PREPARED');
  await assert.rejects(executeIsolatedCandidate(s.db,c,'abcdefghijklmnopqrst'),/OPERATOR_CONTEXT/);assert.deepEqual(await rows(s.db),before);
  await assert.rejects(submittedRestoreSql(s.db,s.verified,s.packet,recoveryDecisionTemplate(s.packet),s.directory,targetRef),/NO_VERIFIED_SELECTIONS/);
  await writeFile(path.join(s.directory,s.descriptor.file),'tampered');await assert.rejects(candidate(s),/FILE_SIZE|FILE_HASH/);await writeFile(path.join(s.directory,s.descriptor.file),s.proofBytes);
  const isolated=await restoreSnapshot(s.verified.snapshot);try{
   const result=await rehearseSubmittedRestore(isolated.db,s.verified,s.packet,s.decisions,s.directory,targetRef);await writeSubmittedCandidate(s.directory,'candidate-stage31',result);await checkSubmittedCandidate(s.directory,'candidate-stage31',result);
   await assert.rejects(writeSubmittedCandidate(s.directory,'candidate-stage31',result),/EEXIST/);await assert.rejects(writeSubmittedCandidate(s.directory,'../escape',result),/INVALID_NAME/);
   for(const f of ['005_submitted_manuscript_restore.sql','verification.json','manifest.json']){const p=path.join(s.directory,'candidate-stage31',f),b=await readFile(p);await writeFile(p,'tamper');await assert.rejects(checkSubmittedCandidate(s.directory,'candidate-stage31',result),/BYTES_CHANGED/);await writeFile(p,b);}
  }finally{await isolated.db.close();}
 }finally{await s.db.close();}
});
test('head and both legacy/authoring schedules block even when a fresh READY binds their exact target',async()=>{
 for(const kind of ['head','legacy-schedule','authoring-schedule']){const s=await setup();try{
  if(kind==='legacy-schedule')await s.db.exec("update episodes set scheduled_at='2099-01-01' where id=100");
  else{
   const version=crypto.randomUUID();await s.db.query("insert into authoring.publication_versions(id,episode_id,work_id,title,content) values($1,100,10,'이미 준비된 공개본','그대로 보존할 공개 원고')",[version]);
   if(kind==='head')await s.db.query('insert into authoring.publication_heads(episode_id,version_id) values(100,$1)',[version]);
   else await s.db.query("insert into authoring.schedules(episode_id,version_id,due_at) values(100,$1,'2099-01-01')",[version]);
  }
  await submit(s);const before=await rows(s.db);await assert.rejects(candidate(s),/PUBLICATION_OR_SCHEDULE_CONFLICT/);assert.deepEqual(await rows(s.db),before);
 }finally{await s.db.close();}}
});
test('failure on one of two selected episodes leaves both originals and all reviews/drafts intact',async()=>{
 const s=await setup();try{
  const first=s.request.id;await s.db.exec("insert into episodes(id,work_id,episode_number,title,content,status) values(300,10,98,'두 번째 기존 제목','두 번째 원래 본문','PUBLISHED');insert into episode_contents values(300,'두 번째 대체 원문',4,null)");
  await submit(s,'300');const d=s.decisions.decisions.find(d=>d.requestId===first),source=s.packet.entries.find(e=>e.requestId===first),second=s.decisions.decisions.find(d=>d.requestId===s.request.id);
  Object.assign(d,{...structuredClone(second),requestId:first,sourceDigest:source.sourceDigest,submittedSha256:source.submittedSha256});
  const c=await candidate(s);assert.equal(c.report.selected,2);
  await s.db.exec("create function public.fail_second_restore() returns trigger language plpgsql as $$ begin if new.episode_id=300 then raise exception 'SYNTHETIC_SECOND_FAILURE';end if;return new;end $$;create trigger fail_second_restore before update on secure_episode_contents for each row execute function public.fail_second_restore()");
  const before=await rows(s.db);await assert.rejects(executeIsolatedCandidate(s.db,c,targetRef),/SYNTHETIC_SECOND_FAILURE/);assert.deepEqual(await rows(s.db),before);
 }finally{await s.db.close();}
});
test('images in a protected legacy path also need explicit evidence even when episode images are empty',async()=>{
 const s=await setup();try{
  await s.db.exec("update secure_episode_contents set image_urls='[\"private/original.png\"]' where episode_id=100");await submit(s);
  assert.equal(s.packet.entries.find(e=>e.requestId===s.request.id).imageCount,0);await assert.rejects(candidate(s),/IMAGE_EVIDENCE_REQUIRED/);
  s.decisions.decisions.find(d=>d.requestId===s.request.id).imageEvidence=s.descriptor;assert.equal((await candidate(s)).report.selected,1);
 }finally{await s.db.close();}
});
test('CLI rehearses/checks exact source without credentials or remote apply; pending requests stay unresolved',async()=>{
 const s=await setup();try{
  await prepareRecoveryPackage(s.directory,s.packet,'review-stage30');await writeFile(path.join(s.directory,'reviewed.json'),JSON.stringify(s.decisions));
  assert.equal((await runSubmittedRestore(['assess',s.directory,'review-stage30'])).selected,0);
  const args=['rehearse',s.directory,'review-stage30','reviewed.json',targetRef,'candidate-stage31'];const report=await runSubmittedRestore(args);
  assert.equal(report.status,'TRANSACTION_CANDIDATE_REHEARSED');assert.equal(report.selected,1);assert.deepEqual(await runSubmittedRestore(['check',...args.slice(1)]),report);
  const pending='pending.json';await writeFile(path.join(s.directory,pending),JSON.stringify(recoveryDecisionTemplate(s.packet)));
  assert.equal((await runSubmittedRestore(['rehearse',s.directory,'review-stage30',pending,targetRef,'no-output'])).selected,0);await assert.rejects(lstat(path.join(s.directory,'no-output')),/ENOENT/);
  for(const a of [[],['assess',s.directory],['assess',s.directory,'review-stage30','extra'],['rehearse',s.directory,'review-stage30'],[...args,'extra']])await assert.rejects(runSubmittedRestore(a),/ARGUMENTS_REQUIRED/);
  const bad=spawnSync(process.execPath,['scripts/prepare_submitted_restore.mjs','--apply',s.directory],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(bad.stderr.trim(),'SUBMITTED_RESTORE_ARGUMENTS_REQUIRED');assert.equal(bad.stdout,'');
  for(const value of [privateSentinel,admin,s.request.id])assert.ok(!JSON.stringify(report).includes(value));assert.ok(sha(JSON.stringify(report)));
 }finally{await s.db.close();}
});
