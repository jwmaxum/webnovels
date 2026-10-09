import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink,lstat} from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {setup,ready,admin,draft,privateSentinel,snapshotOf} from './fixtures/stage30-evidence.mjs';
import {sha} from './lib/launch-content-review.mjs';import {restoreSnapshot} from './verify_launch_backup.mjs';
import {buildRecoveryPacket,recoveryDecisionTemplate,validateRecoveryPacket,validateRecoveryDecisions,verifyRecoveryEvidence,
 recoveryEvidenceSummary,prepareRecoveryPackage,checkRecoveryPackage,rehearseRecoveryPlan,writeRecoveryRehearsal} from './lib/recovery-evidence.mjs';
import {runRecoveryEvidence} from './prepare_recovery_evidence.mjs';
test('fixed submission/source lineage, latest audited READY and private auth hashes form an exact separate packet',async()=>{
 const s=await setup();try{const p=s.packet,e=p.entries[0];assert.equal(p.entries.length,1);assert.deepEqual(p.missingPrerequisites,[]);assert.deepEqual(e.blockedReasons,[]);assert.equal(e.revision,'1');assert.equal(e.sourceRevision,'1');assert.equal(e.reviewStatus,'READY_FOR_RESTORE_REVIEW');assert.ok(!JSON.stringify(p).includes(privateSentinel));
  const template=recoveryDecisionTemplate(p),valid=validateRecoveryDecisions(p,template);assert.equal(valid.pending.length,1);assert.equal(recoveryEvidenceSummary(p,valid).freeCutoverAccepted,false);
  await s.rpc('creator_drafts',[admin,'save','10',draft,JSON.stringify({expectedRevision:'1',title:'후속 수정',content:'별도 후속 편집본',authorComment:''}),crypto.randomUUID(),'0']);
  const now=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.equal(now.entries[0].submitted.content,'제출 당시 비공개 원고 😀');assert.deepEqual(now.entries[0].blockedReasons,[]);assert.equal(now.entries[0].revision,'1');assert.notEqual(now.snapshotSha256,p.snapshotSha256);
 }finally{await s.db.close();}
});
test('unknown fields, precision loss, stale source/packet and duplicate/missing selections reject',async()=>{
 const s=await setup();try{
  for(const mutate of [p=>p.extra=true,p=>p.entries[0].workId=9007199254740993,p=>p.entries[0].revision='9223372036854775808',p=>p.entries[0].sourceRevision='2',p=>p.entries[0].submitted.content='tamper',p=>p.entries.push(p.entries[0])]){const p=structuredClone(s.packet);mutate(p);assert.throws(()=>validateRecoveryPacket(p));}
  for(const mutate of [r=>r.extra=true,r=>r.snapshotSha256='b'.repeat(64),r=>r.packetSha256='b'.repeat(64),r=>r.decisions.pop(),r=>r.decisions[0].sourceDigest='b'.repeat(64),r=>r.decisions[0].submittedSha256='b'.repeat(64),r=>r.decisions[0].requestId=crypto.randomUUID()]){const r=structuredClone(s.decisions);mutate(r);assert.throws(()=>validateRecoveryDecisions(s.packet,r));}
  const p=structuredClone(s.packet);p.entries[0].workId='9007199254740993';assert.equal(validateRecoveryPacket(p).entries[0].workId,'9007199254740993');
  const sized=structuredClone(s.packet);sized.entries[0].source.padding='';sized.entries[0].source.padding='a'.repeat(48*1024*1024-Buffer.byteLength(JSON.stringify(sized))-1);sized.entries[0].sourceDigest=sha(JSON.stringify(sized.entries[0].source));
  assert.ok(Buffer.byteLength(JSON.stringify(sized))<48*1024*1024);assert.ok(Buffer.byteLength(JSON.stringify(sized,null,2)+'\n')>48*1024*1024);assert.throws(()=>validateRecoveryPacket(sized),/INVALID_PACKET/);
 }finally{await s.db.close();}
});
test('edited submission retains the imported original and SQL bigint episode precision',async()=>{
 const s=await setup();try{
  const episode='9007199254740993';await s.db.query("insert into public.episodes(id,work_id,episode_number,title,content,status) values($1,10,99,'별도 원래 회차','기존 보존 본문','PUBLISHED')",[episode]);
  await s.rpc('creator_drafts',[admin,'save','10',draft,JSON.stringify({expectedRevision:'1',title:'편집 제출',content:'가져온 뒤 편집한 실제 제출본',authorComment:'편집 메모'}),crypto.randomUUID(),'0']);
  const options=await s.rpc('creator_draft_recovery',[admin,'options','10',draft,'{}',null,'0']),target=options.episodes.find(e=>e.id===episode);assert.ok(target);
  const submitted=await s.rpc('creator_draft_recovery',[admin,'submit','10',draft,JSON.stringify({...s.submission,expectedRevision:'2',episodeId:episode,targetDigest:target.targetDigest}),crypto.randomUUID(),'0']);assert.ok(submitted.request);
  await ready({...s,request:submitted.request});const packet=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed),row=packet.entries.find(e=>e.requestId===submitted.request.id);
  assert.equal(row.episodeId,episode);assert.equal(row.revision,'2');assert.equal(row.sourceRevision,'1');assert.equal(row.imported.content,'제출 당시 비공개 원고 😀');assert.equal(row.submitted.content,'가져온 뒤 편집한 실제 제출본');assert.notEqual(row.importedSha256,row.submittedSha256);assert.deepEqual(row.blockedReasons,[]);
 }finally{await s.db.close();}
});
test('PENDING/HOLD never imply source selection; actual original/rights/rating/AI checks and no duplicate target required',async()=>{
 const s=await setup();try{
  for(const field of ['originalFile','rightsEvidence','ratingEvidence','aiEvidence']){const r=structuredClone(s.decisions);r.decisions[0][field]=null;assert.throws(()=>validateRecoveryDecisions(s.packet,r),/ACTUAL_EVIDENCE/);}
  for(const mutate of [d=>d.reviewerRef='',d=>d.evidenceRef='short',d=>d.originalFile.bytes++,d=>d.originalFile.sha256='b'.repeat(64),d=>d.originalFile.bytes=2097153,d=>d.rightsEvidence.bytes=16777217,d=>d.rightsEvidence.file='.env.local',d=>d.originalFile.file='../original.bin']){const r=structuredClone(s.decisions);mutate(r.decisions[0]);assert.throws(()=>validateRecoveryDecisions(s.packet,r));}
  const hold=recoveryDecisionTemplate(s.packet);Object.assign(hold.decisions[0],{decision:'HOLD',reviewerRef:'operator',evidenceRef:'실제 권리 근거 대기'});assert.equal(validateRecoveryDecisions(s.packet,hold).held.length,1);hold.decisions[0].rightsEvidence=s.descriptor;assert.throws(()=>validateRecoveryDecisions(s.packet,hold),/UNSELECTED_EVIDENCE/);
  const noReason=recoveryDecisionTemplate(s.packet);noReason.decisions[0].decision='HOLD';assert.throws(()=>validateRecoveryDecisions(s.packet,noReason),/HOLD_REASON/);
  const p=structuredClone(s.packet),second={...structuredClone(p.entries[0]),requestId:crypto.randomUUID()};p.entries.push(second);const r=structuredClone(s.decisions);r.packetSha256=sha(JSON.stringify(p));r.decisions.push({...structuredClone(r.decisions[0]),requestId:second.requestId});assert.throws(()=>validateRecoveryDecisions(p,r),/DUPLICATE_TARGET/);
 }finally{await s.db.close();}
});
test('latest HOLD overrides earlier READY; current administrator or author revocation invalidates evidence chain',async()=>{
 const s=await setup();try{await ready(s,'HOLD');let p=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.equal(p.entries[0].reviewStatus,'HOLD');assert.ok(p.entries[0].blockedReasons.includes('LATEST_REVIEW_NOT_READY'));
  await ready(s);await s.db.exec('begin');for(const change of ["update admin_users set role='SUB_ADMIN' where auth_user_id='"+admin+"'","update authors set status='SUSPENDED' where id=1","update auth.users set banned_until=now()+interval '1 day' where id='"+admin+"'"]){await s.db.exec('savepoint mutation');await s.db.exec(change);p=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.ok(p.entries[0].blockedReasons.length);await s.db.exec('rollback to mutation;release mutation');}await s.db.exec('commit');
 }finally{await s.db.close();}
});
test('snapshot/target/source file tamper or missing source rows fails closed; original helper code must stay bound',async()=>{
 const s=await setup();try{await s.db.exec('begin');for(const change of ["update episodes set content='changed' where id=100","update authoring.files set sha256=repeat('b',64)","update authoring.file_jobs set state='PREPARED'"]){await s.db.exec('savepoint mutation');await s.db.exec(change);const p=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.ok(p.entries[0].blockedReasons.includes('CURRENT_CONTEXT_INVALID'));await s.db.exec('rollback to mutation;release mutation');}await s.db.exec('commit');
  const p=structuredClone(s.packet);p.helperSha256='b'.repeat(64);await assert.rejects(rehearseRecoveryPlan(s.db,s.verified,p,{...s.decisions,packetSha256:sha(JSON.stringify(p))},s.directory),/REHEARSAL_SOURCE_CHANGED/);
 }finally{await s.db.close();}
});
test('latest review binds the whole receipt and audit including reason, work and timestamp',async()=>{
 const s=await setup();try{
  await s.db.exec('begin;alter table authoring.workflow_events disable trigger all;alter table authoring.recovery_review_receipts disable trigger all');
  for(const change of ["update authoring.workflow_events set reason='changed' where action='recovery-decide'","update authoring.workflow_events set work_id=20 where action='recovery-decide'","update authoring.workflow_events set created_at=created_at+interval '1 second' where action='recovery-decide'","update authoring.workflow_events set detail='{}' where action='recovery-decide'","update authoring.recovery_review_receipts set result=jsonb_set(result,'{reason}','\"changed\"')","update authoring.recovery_review_receipts set result=jsonb_set(result,'{createdAt}','\"2000-01-01T00:00:00Z\"')"]){
   await s.db.exec('savepoint corruption');await s.db.exec(change);const p=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.ok(p.entries[0].blockedReasons.includes('REVIEW_EVIDENCE_CHAIN_INVALID'));await s.db.exec('rollback to corruption;release corruption');
  }await s.db.exec('rollback');
 }finally{await s.db.close();}
});
test('development seed, empty submitted novel and image evidence cannot become a prepared restore',async()=>{
 const s=await setup({review:false});try{
  const expression=s.seed.match(/ep_id,\s*('제 '[\s\S]+?),\s*1\s*\)\s*ON CONFLICT \(episode_id\)/)[1].replaceAll('ep_num','1');
  const seedBody=(await s.db.query('select '+expression+' body')).rows[0].body;
  await s.db.exec('begin');for(const content of ['   ',seedBody]){
   await s.db.exec('savepoint mutation;alter table authoring.draft_revisions disable trigger all');await s.db.query('update authoring.draft_revisions set content=$1',[content]);
   const p=await buildRecoveryPacket(s.db,await snapshotOf(s.db),s.seed);assert.ok(p.entries[0].blockedReasons.includes(content.trim()?'DEVELOPMENT_SEED':'EMPTY_SUBMITTED_NOVEL'));
   await s.db.exec('rollback to mutation;release mutation');
  }await s.db.exec('commit');
  const p=structuredClone(s.packet);Object.assign(p.entries[0],{imageCount:1,blockedReasons:[],reviewStatus:'READY_FOR_RESTORE_REVIEW',reviewRevision:'1'});const r=structuredClone(s.decisions);Object.assign(r.decisions[0],{decision:'PREPARE_RESTORE',submittedSha256:p.entries[0].submittedSha256,reviewerRef:'reviewer',evidenceRef:'합성 검증용 권리 자료 검토',originalFile:{file:'originals/input/manuscript.bin',bytes:p.entries[0].fileBytes,sha256:p.entries[0].fileSha256},rightsEvidence:s.descriptor,ratingEvidence:s.descriptor,aiEvidence:s.descriptor});r.packetSha256=sha(JSON.stringify(p));assert.throws(()=>validateRecoveryDecisions(p,r),/IMAGE_EVIDENCE_REQUIRED/);r.decisions[0].imageEvidence=s.descriptor;assert.equal(validateRecoveryDecisions(p,r).selected.length,1);
 }finally{await s.db.close();}
});
test('actual byte SHA/size, relative paths and file/directory links are independently checked',async()=>{
 const s=await setup();try{const v=validateRecoveryDecisions(s.packet,s.decisions);await verifyRecoveryEvidence(s.directory,v);
  await writeFile(path.join(s.directory,s.descriptor.file),Buffer.alloc(s.descriptor.bytes));await assert.rejects(verifyRecoveryEvidence(s.directory,v),/FILE_HASH/);await writeFile(path.join(s.directory,s.descriptor.file),'short');await assert.rejects(verifyRecoveryEvidence(s.directory,v),/FILE_SIZE/);
  await writeFile(path.join(s.directory,s.descriptor.file),s.proofBytes);
  await mkdir(path.join(s.directory,'original-target'));await writeFile(path.join(s.directory,'original-target/manuscript.bin'),await readFile(path.join(s.directory,'originals/input/manuscript.bin')));
  await symlink(path.join(s.directory,'original-target'),path.join(s.directory,'originals/input/link'),'junction');
  const r=structuredClone(s.decisions);r.decisions[0].originalFile.file='originals/input/link/manuscript.bin';await assert.rejects(verifyRecoveryEvidence(s.directory,validateRecoveryDecisions(s.packet,r)),/LINK_FORBIDDEN/);
 }finally{await s.db.close();}
});
test('new package outputs never overwrite; check regenerates source and rejects manifest/template/packet tamper',async()=>{
 const s=await setup();try{
  const report=await prepareRecoveryPackage(s.directory,s.packet,'review-stage30');assert.equal(report.pending,1);await checkRecoveryPackage(s.directory,s.packet,'review-stage30');await assert.rejects(prepareRecoveryPackage(s.directory,s.packet,'review-stage30'),/EEXIST/);await assert.rejects(prepareRecoveryPackage(s.directory,s.packet,'../escape'),/INVALID_NAME/);
  for(const file of ['manifest.json','packet.json','decisions-template.json']){const p=path.join(s.directory,'review-stage30',file),bytes=await readFile(p);await writeFile(p,JSON.stringify({tamper:true}));await assert.rejects(checkRecoveryPackage(s.directory,s.packet,'review-stage30'));await writeFile(p,bytes);}
  await assert.rejects(checkRecoveryPackage(s.directory,{...s.packet,snapshotSha256:'b'.repeat(64)},'review-stage30'),/STALE_PACKAGE/);await assert.rejects(checkRecoveryPackage(s.directory,s.packet,'..'),/INVALID_NAME/);
 }finally{await s.db.close();}
});
test('fresh isolated snapshot row rehearsal preserves every original and builds a private plan with no apply/publication',async()=>{
 const s=await setup();let isolated;try{isolated=await restoreSnapshot(s.verified.snapshot);const packet=await buildRecoveryPacket(isolated.db,s.verified,s.seed);assert.deepEqual(packet,s.packet);
  const result=await rehearseRecoveryPlan(isolated.db,s.verified,packet,s.decisions,s.directory);assert.equal(result.plan.mode,'PLAN_ONLY_NO_APPLY');assert.equal(result.plan.selections[0].submitted.content,s.packet.entries[0].submitted.content);assert.equal(result.plan.publicationChanged,false);assert.equal(result.report.bodyReplacementExecuted,false);assert.equal(result.report.preservedRows,s.verified.snapshot.tables.reduce((n,t)=>n+t.rows.length,0));assert.equal(result.report.hostedRestoreAccepted,false);
  await writeRecoveryRehearsal(s.directory,'rehearsal-stage30',result);await assert.rejects(writeRecoveryRehearsal(s.directory,'rehearsal-stage30',result),/EEXIST/);await assert.rejects(writeRecoveryRehearsal(s.directory,'../escape',result),/INVALID_NAME/);
  await isolated.db.exec("update storage.buckets set name='changed' where id='existing'");await assert.rejects(rehearseRecoveryPlan(isolated.db,s.verified,packet,s.decisions,s.directory),/SOURCE_ROWS_CHANGED/);
 }finally{if(isolated)await isolated.db.close();await s.db.close();}
});
test('missing recovery migrations/tables and unreviewed requests stay unresolved; no approved selection is invented',async()=>{
 const s=await setup({review:false});try{assert.ok(s.packet.entries[0].blockedReasons.includes('LATEST_REVIEW_NOT_READY'));const r=recoveryDecisionTemplate(s.packet);assert.equal(recoveryEvidenceSummary(s.packet,validateRecoveryDecisions(s.packet,r)).selected,0);
  await assert.rejects(rehearseRecoveryPlan(s.db,s.verified,s.packet,r,s.directory),/NO_VERIFIED_SELECTIONS/);
  const verified={...s.verified,snapshot:{...s.verified.snapshot,tables:s.verified.snapshot.tables.filter(t=>t.name!=='recovery_requests')}};const p=await buildRecoveryPacket(s.db,verified,s.seed);assert.equal(p.entries.length,0);assert.ok(p.missingPrerequisites.includes('TABLE:authoring.recovery_requests'));assert.equal(recoveryEvidenceSummary(p,validateRecoveryDecisions(p,recoveryDecisionTemplate(p))).status,'SOURCE_PREREQUISITES_MISSING');
 }finally{await s.db.close();}
});
test('offline CLI prepare/check/rehearse reconstructs verified source and prints no manuscript/account credentials',async()=>{
 const s=await setup();try{
  const prepared=await runRecoveryEvidence(['prepare',s.directory,'cli-stage30']);assert.equal(prepared.pending,1);assert.equal((await runRecoveryEvidence(['check',s.directory,'cli-stage30'])).requests,1);
  await writeFile(path.join(s.directory,'reviewed.json'),JSON.stringify(s.decisions));const result=await runRecoveryEvidence(['rehearse',s.directory,'cli-stage30','reviewed.json','candidate-stage30']);assert.equal(result.selected,1);assert.equal(result.productionChanged,false);
  for(const secret of [privateSentinel,s.packet.entries[0].submitted.content,admin,s.packet.entries[0].requestId])assert.ok(!JSON.stringify(result).includes(secret));
  const invalid=spawnSync(process.execPath,['scripts/prepare_recovery_evidence.mjs','--apply',s.directory],{encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(invalid.stderr.trim(),'RECOVERY_EVIDENCE_ARGUMENTS_REQUIRED');assert.ok(!invalid.stdout);
  for(const args of [[],['prepare',s.directory,'cli-stage30','extra'],['rehearse',s.directory,'cli-stage30'],['prepare',s.directory,'x','a','b','c']])await assert.rejects(runRecoveryEvidence(args),/ARGUMENTS_REQUIRED/);
  await writeFile(path.join(s.directory,'pending.json'),JSON.stringify(recoveryDecisionTemplate(s.packet)));assert.equal((await runRecoveryEvidence(['rehearse',s.directory,'cli-stage30','pending.json','no-output'])).selected,0);await assert.rejects(lstat(path.join(s.directory,'no-output')),/ENOENT/);
 }finally{await s.db.close();}
});
