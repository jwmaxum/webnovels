import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdir,mkdtemp,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {buildContentPacket,decisionTemplate,validateContentDecisions,reviewSummary,contentSelectionSql,
  verifyReviewEvidence,privateBackupDirectory,readVerifiedSnapshot,sha} from './lib/launch-content-review.mjs';
import {rehearseSelections} from './review_launch_content.mjs';
const template=await readFile(new URL('../database/launch/004_reviewed_content_selection.sql',import.meta.url),'utf8');
const seed="ep_id, '제 ' || ep_num || ' 예시', 1) ON CONFLICT (episode_id)";
const e1='9007199254740993',e2='9007199254740994',e3='9007199254740995';
const proof={file:'rights.txt',bytes:5,sha256:sha('proof')};
async function setup(){
  const db=await PGlite.create();
  await db.exec(`set timezone='UTC';create schema auth;create schema authoring;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean,banned_until timestamptz);
    insert into auth.users values('11111111-1111-4111-8111-111111111111','2026-01-01',null,false,null);
    create table authors(id bigint primary key,auth_user_id uuid references auth.users);
    insert into authors values(11,'11111111-1111-4111-8111-111111111111');
    create table works(id bigint primary key,author_id bigint references authors,content_type text,title text);
    insert into works values(21,11,'NOVEL','원작'),(22,11,'WEBTOON','이미지');
    create table episodes(id bigint primary key,work_id bigint references works,episode_number int,content text,image_urls text[]);
    insert into episodes values(${e1},21,1,E'진짜 원문\\n둘째 줄',null),(${e2},22,2,null,array['private/original.png']),(${e3},21,3,'   ',null);
    create table episode_contents(episode_id bigint primary key references episodes,text_content text,content_version int,updated_at timestamptz);
    insert into episode_contents values(${e1},'별도 원작',1,'2026-01-01'),(${e2},'제 2 예시',1,'2026-01-01'),(${e3},'확인된 대체 원작',1,'2026-01-01');
    create table authoring.identity_evidence(profile_kind text,profile_id text,auth_user_id uuid references auth.users,evidence_ref text,primary key(profile_kind,profile_id));
    insert into authoring.identity_evidence values('author','11','11111111-1111-4111-8111-111111111111','verified-owner-proof');
    create table authoring.drafts(id text primary key,body text);insert into authoring.drafts values('draft-1','보존할 초안');`);
  const tables=[];
  for(const [schema,name] of [['auth','users'],['public','authors'],['public','works'],['public','episodes'],['public','episode_contents'],['authoring','identity_evidence'],['authoring','drafts']]){
    const rows=(await db.query(`select to_jsonb(r)::text row from ${schema}.${name} r order by to_jsonb(r)::text`)).rows.map(r=>r.row);
    tables.push({schema,name,row_count:String(rows.length),rows});
  }
  const snapshot={captured_at:'2026-10-09T00:00:00Z',tables};
  const verified={snapshot,hash:sha(JSON.stringify(snapshot)),manifest:{projectRef:'abcdefghijklmnopqrst'}};
  const packet=await buildContentPacket(db,verified,seed),review=decisionTemplate(packet);
  return {db,snapshot,verified,packet,review};
}
function approve(review,packet,id,choice='USE_EPISODES'){
  const d=review.decisions.find(d=>d.episodeId===id),row=packet.entries.find(r=>r.episodeId===id);
  Object.assign(d,{decision:choice,reviewerRef:'verified-operator',evidenceRef:'owner-original-ticket-23',rightsEvidence:proof,
    imageEvidence:row.contentType==='WEBTOON'?proof:null,selectedSourceSha256:choice==='USE_EPISODES'?row.episodesSourceSha256:row.episodeContentsSourceSha256});
}
test('packet preserves bigint, both manuscripts, null/blank, author/Auth domains and seed provenance',async()=>{
  const {db,packet,review}=await setup();try{
    assert.deepEqual(packet.entries.map(r=>r.episodeId),[e1,e2,e3]);assert.equal(packet.entries[0].authorId,'11');
    assert.equal(packet.entries[1].alternateIsSeed,true);assert.equal(packet.entries[1].episodesEmpty,true);
    assert.equal(JSON.parse(packet.entries[1].source.episode).content,null);
    assert.notEqual(packet.entries[1].episodesSourceSha256,sha(JSON.stringify('')));
    assert.equal(validateContentDecisions(packet,review).pending.length,3);
    assert.equal(reviewSummary(packet,validateContentDecisions(packet,review)).freeCutoverAccepted,false);
    const again=await buildContentPacket(db,{snapshot:{captured_at:packet.capturedAt},manifest:{projectRef:packet.projectRef},hash:packet.snapshotSha256},seed);
    assert.deepEqual(again,packet);
  }finally{await db.close();}
});
test('HOLD preserves unresolved blockers; no source decision or SQL is inferred',async()=>{
  const {db,packet,review}=await setup();try{
    for(const d of review.decisions)Object.assign(d,{decision:'HOLD',reviewerRef:'operator',evidenceRef:'awaiting-original-evidence'});
    const valid=validateContentDecisions(packet,review);assert.equal(valid.held.length,3);assert.equal(valid.unresolved,3);
    assert.throws(()=>contentSelectionSql(packet,valid,template),/NO_APPROVED_SELECTIONS/);
    review.decisions[0].evidenceRef=null;assert.throws(()=>validateContentDecisions(packet,review),/REVIEWER_EVIDENCE_REQUIRED/);
  }finally{await db.close();}
});
test('snapshot/source hashes, duplicate/missing/unknown IDs and unknown JSON fields fail closed',async()=>{
  const {db,packet,review}=await setup();try{
    for(const mutate of [r=>r.snapshotSha256='0'.repeat(64),r=>r.packetSha256='0'.repeat(64),r=>r.decisions[0].sourceDigest='0'.repeat(64),
      r=>r.decisions.pop(),r=>r.decisions[1]={...r.decisions[0]},r=>r.decisions[0].episodeId='1',r=>r.decisions[0].workId='21',
      r=>r.extra=true,r=>r.decisions[0].episodeId=Number(e1),r=>r.decisions[0].episodeId='9223372036854775808']){
      const changed=structuredClone(review);mutate(changed);assert.throws(()=>validateContentDecisions(packet,changed),/CONTENT_REVIEW_/);
    }
  }finally{await db.close();}
});
test('approval requires mapped owner, reviewer, hash-bound selected source and rights proof',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review,packet,e1);assert.equal(validateContentDecisions(packet,review).selected.length,1);
    for(const mutate of [r=>r.decisions[0].reviewerRef='',r=>r.decisions[0].rightsEvidence=null,r=>r.decisions[0].selectedSourceSha256='0'.repeat(64)]){
      const changed=structuredClone(review);mutate(changed);assert.throws(()=>validateContentDecisions(packet,changed),/CONTENT_REVIEW_/);
    }
    const bad=structuredClone(packet);bad.entries[0].authMappingVerified=false;const r=decisionTemplate(bad);approve(r,bad,e1);
    assert.throws(()=>validateContentDecisions(bad,r),/VERIFIED_OWNER_REQUIRED/);
  }finally{await db.close();}
});
test('empty novels and seed examples cannot be selected; webtoons require images and independent evidence',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review,packet,e3);assert.throws(()=>validateContentDecisions(packet,review),/EMPTY_NOVEL_FORBIDDEN/);
    review.decisions[2]=decisionTemplate(packet).decisions[2];approve(review,packet,e2,'USE_EPISODE_CONTENTS');
    assert.throws(()=>validateContentDecisions(packet,review),/DEVELOPMENT_SEED_FORBIDDEN/);
    approve(review,packet,e2);assert.equal(validateContentDecisions(packet,review).selected.length,1);
    review.decisions[1].imageEvidence=null;assert.throws(()=>validateContentDecisions(packet,review),/IMAGE_EVIDENCE_REQUIRED/);
    const missing=structuredClone(packet);missing.entries[1].imageCount=0;const r=decisionTemplate(missing);approve(r,missing,e2);
    assert.throws(()=>validateContentDecisions(missing,r),/IMAGE_EVIDENCE_REQUIRED/);
  }finally{await db.close();}
});
test('private evidence bytes/hash/path and verified backup checks reject tampering',async()=>{
  await mkdir('scratch/launch/backups',{recursive:true});const root=await mkdtemp(path.resolve('scratch/launch/backups/stage23-test-'));
  const {db,packet,review,verified}=await setup();try{
    await writeFile(path.join(root,'rights.txt'),'proof');approve(review,packet,e1);
    await verifyReviewEvidence(root,validateContentDecisions(packet,review));
    await writeFile(path.join(root,'rights.txt'),'other');await assert.rejects(verifyReviewEvidence(root,validateContentDecisions(packet,review)),/EVIDENCE_HASH_MISMATCH/);
    await writeFile(path.join(root,'rights.txt'),'no');await assert.rejects(verifyReviewEvidence(root,validateContentDecisions(packet,review)),/EVIDENCE_SIZE_MISMATCH/);
    review.decisions[0].rightsEvidence.file='../.env.local';await assert.rejects(verifyReviewEvidence(root,validateContentDecisions(packet,review)),/UNSAFE_PATH/);
    assert.equal(await privateBackupDirectory(root),root);await assert.rejects(privateBackupDirectory('scratch'),/PRIVATE_DIRECTORY_REQUIRED/);
    await writeFile(path.join(root,'snapshot.json'),JSON.stringify(verified.snapshot));
    await writeFile(path.join(root,'manifest.json'),JSON.stringify({snapshotSha256:verified.hash,projectRef:verified.manifest.projectRef}));
    await writeFile(path.join(root,'data-restore-verification.json'),JSON.stringify({snapshotSha256:verified.hash,allRowsMatch:true,tablesVerified:7,rowsVerified:12}));
    await readVerifiedSnapshot(root);
    await writeFile(path.join(root,'snapshot.json'),'{}');await assert.rejects(readVerifiedSnapshot(root),/VERIFIED_SNAPSHOT_REQUIRED/);
    // Junction permission differs on Windows; the existing recovery suite separately checks symlinks.
    try{await symlink(root,path.join(root,'linked'),'junction');await assert.rejects(privateBackupDirectory(path.join(root,'linked')),/LINK_FORBIDDEN/);}catch(e){if(e.code!=='EPERM')throw e;}
  }finally{await db.close();}
});
test('CAS rehearsal changes only approved manuscripts; holds/drafts/images/IDs remain and archive is private/immutable',async()=>{
  const {db,snapshot,packet,review}=await setup();try{
    approve(review,packet,e1);approve(review,packet,e2);Object.assign(review.decisions[2],{decision:'HOLD',reviewerRef:'operator',evidenceRef:'hold-novel-original-needed'});
    const result=await rehearseSelections(db,snapshot,packet,validateContentDecisions(packet,review),template);
    assert.equal(result.report.privateImmutableArchive,true);assert.equal(result.report.replayRejected,true);assert.equal(result.report.held,1);
    assert.equal(result.report.productionChanged,false);assert.equal(result.report.freeCutoverAccepted,false);
    const rows=(await db.query('select e.id::text id,e.content,c.text_content,e.image_urls from episodes e join episode_contents c on c.episode_id=e.id order by e.id')).rows;
    assert.equal(rows[0].content,rows[0].text_content);assert.equal(rows[1].text_content,null);assert.equal(rows[2].content,'   ');
    assert.deepEqual(rows[1].image_urls,['private/original.png']);assert.equal((await db.query('select body from authoring.drafts')).rows[0].body,'보존할 초안');
    assert.equal((await db.query('select before_data->\'content\'->>\'text_content\' original from launch_recovery.content_selection_history where episode_id=$1',[e2])).rows[0].original,'제 2 예시');
  }finally{await db.close();}
});
test('alternate verified manuscript can be chosen without changing work type/owner or the alternate source',async()=>{
  const {db,snapshot,packet,review}=await setup();try{
    approve(review,packet,e3,'USE_EPISODE_CONTENTS');const result=await rehearseSelections(db,snapshot,packet,validateContentDecisions(packet,review),template);
    assert.equal(result.report.approved,1);assert.equal((await db.query('select content from episodes where id=$1',[e3])).rows[0].content,'확인된 대체 원작');
    assert.equal((await db.query('select content_version from episode_contents where episode_id=$1',[e3])).rows[0].content_version,1);
  }finally{await db.close();}
});
test('one stale source, owner, type, Auth or evidence row rolls back all selections and history',async()=>{
  for(const mutation of [`update episode_contents set text_content='concurrent' where episode_id=${e2}`,
    "update works set title='concurrent' where id=22","update authors set auth_user_id=null where id=11",
    "update works set content_type='NOVEL' where id=22","update auth.users set banned_until='2099-01-01'",
    "update authoring.identity_evidence set evidence_ref='concurrent'"]){
    const {db,packet,review}=await setup();try{
      approve(review,packet,e1);approve(review,packet,e2);const sql=contentSelectionSql(packet,validateContentDecisions(packet,review),template).sql;
      await db.exec('create role anon;create role authenticated;create role service_role');await db.exec(mutation);
      await assert.rejects(db.exec(sql),/stale, unverified or invalid/);await db.exec('rollback');
      assert.equal((await db.query('select text_content from episode_contents where episode_id=$1',[e1])).rows[0].text_content,'별도 원작');
      assert.equal((await db.query("select to_regclass('launch_recovery.content_selection_history') t")).rows[0].t,null);
    }finally{await db.close();}
  }
});
