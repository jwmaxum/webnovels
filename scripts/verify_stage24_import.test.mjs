import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setup as foundation,admin,reader} from './fixtures/stage22-db.mjs';
import {sha} from './lib/launch-content-review.mjs';
import {buildLegacyImportPacket,legacyImportTemplate,validateLegacyImport,verifyLegacyImportEvidence,
  legacyImportSummary,legacyImportSql} from './lib/legacy-publication-import.mjs';
import {rehearseLegacyImport} from './prepare_legacy_publications.mjs';
const template=await readFile(new URL('../database/launch/005_import_verified_legacy_novels.sql',import.meta.url),'utf8');
const seed="ep_id, '제 ' || ep_num || ' 예시', 1) ON CONFLICT (episode_id)";
const large='9007199254740993',proof={file:'rights.txt',bytes:5,sha256:sha('proof')};
async function snapshotOf(db){
  await db.exec("set timezone='UTC'");
  const names=(await db.query("select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','auth','storage','authoring','growth','launch_recovery') order by 1,2")).rows;
  const tables=[];for(const t of names){const rows=(await db.query(`select to_jsonb(r)::text row from "${t.schema}"."${t.name}" r`)).rows.map(r=>r.row);tables.push({...t,rows,row_count:String(rows.length)})}
  return {captured_at:new Date().toISOString(),tables};
}
async function packetOf(db){const snapshot=await snapshotOf(db);return {snapshot,packet:await buildLegacyImportPacket(db,{snapshot,manifest:{projectRef:'abcdefghijklmnopqrst'},hash:sha(JSON.stringify(snapshot))},seed)}}
async function setup(){const f=await foundation();try{
  await f.db.exec(`alter table auth.users add deleted_at timestamptz;
    insert into authoring.identity_evidence(profile_kind,profile_id,auth_user_id,evidence_ref,verified_by)
      values('author','1','${admin}','synthetic-owner-ticket','${admin}');
    create table public.episode_contents(episode_id bigint primary key references public.episodes(id),text_content text);
    update episodes set created_at=now()-interval '3 days' where id=100;
    insert into episodes(id,work_id,episode_number,title,content,image_urls,status,created_at)
      values(${large},10,2,'정확한 bigint','원문\n둘째 줄',null,'PUBLISHED',now()-interval '3 days');
    insert into episode_contents select id,content from episodes;
    update authoring.work_state set visibility='PUBLIC' where work_id=10;`);
  const {snapshot,packet}=await packetOf(f.db);return {...f,snapshot,packet,review:legacyImportTemplate(packet)};
 }catch(e){await f.db.close();throw e}}
function approve(review,id='100'){
  review.cutoverEvidence=proof;Object.assign(review.decisions.find(d=>d.episodeId===id),{decision:'IMPORT',reviewerRef:'verified-operator',
    evidenceRef:'original-rights-ticket-24',rightsEvidence:proof,originalPublishedAt:new Date(Date.now()-2*86400000).toISOString()});
}
async function failsSql(db,sql,pattern){await assert.rejects(db.exec(sql),pattern);await db.exec('rollback')}
test('packet preserves raw source/null images/bigint domains and never infers approvals',async()=>{
  const {db,packet,review}=await setup();try{
    assert.ok(packet.entries.find(e=>e.episodeId===large).eligible);
    assert.equal(JSON.parse(packet.entries.find(e=>e.episodeId===large).source.episode).image_urls,null);
    assert.equal(validateLegacyImport(packet,review).selected.length,0);
    const summary=legacyImportSummary(packet,validateLegacyImport(packet,review));assert.equal(summary.eligibleNovelEpisodes,2);
    assert.equal(summary.productionApplied,false);assert.equal(summary.freeCutoverAccepted,false);
    assert.throws(()=>legacyImportSql(packet,validateLegacyImport(packet,review),template),/NO_APPROVED_IMPORTS/);
    await assert.rejects(buildLegacyImportPacket(db,{snapshot:{captured_at:packet.capturedAt},manifest:{},hash:packet.snapshotSha256},'bad seed'),/SEED_PROVENANCE/);
  }finally{await db.close()}
});
test('review hashes, complete unique IDs, rights/cutover proof and original publication timestamp are mandatory',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review);assert.equal(validateLegacyImport(packet,review).selected.length,1);
    for(const mutate of [r=>r.snapshotSha256='0'.repeat(64),r=>r.packetSha256='0'.repeat(64),r=>r.decisions.pop(),
      r=>r.decisions[1]={...r.decisions[0]},r=>r.decisions[0].sourceDigest='0'.repeat(64),r=>r.decisions[0].episodeId=100,
      r=>r.decisions[0].rightsEvidence=null,r=>r.cutoverEvidence=null,r=>r.decisions[0].reviewerRef='',r=>r.extra=true,
      r=>r.decisions[0].originalPublishedAt='2000-01-01T00:00:00Z',r=>r.decisions[0].originalPublishedAt='2099-01-01T00:00:00Z']){
      const copy=structuredClone(review);mutate(copy);assert.throws(()=>validateLegacyImport(packet,copy),/LEGACY_IMPORT_/);
    }
    const hold=structuredClone(review);hold.decisions[0].decision='HOLD';assert.equal(validateLegacyImport(packet,hold).held,1);
    for(const key of ['p0Expanded','publicationMigrationApplied','bodyConflicts']){
      const copy=structuredClone(packet);copy.prerequisites[key]=key==='bodyConflicts'?1:false;
      const r=legacyImportTemplate(copy);approve(r);assert.throws(()=>validateLegacyImport(copy,r),/CUTOVER_PREREQUISITES/);
    }
  }finally{await db.close()}
});
test('source eligibility excludes paid, webtoon, adult, seed, moderated/unreviewed and unverified owners',async()=>{
  const {db}=await setup();try{
    for(const query of ["update works set content_type='WEBTOON' where id=10","update works set rating='ADULT' where id=10",
      "update works set genre=array['성인'] where id=10","update episodes set is_free=false where id=100",
      "update episodes set scheduled_at=now()+interval '1 day' where id=100","update authoring.work_state set rating_confirmed=false where work_id=10",
      "update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='synthetic review' where work_id=10","update authors set status='PENDING' where id=1",
      `update auth.users set banned_until=now()+interval '1 day' where id='${admin}'`,
      "update episodes set content='제 1 예시' where id=100;update episode_contents set text_content='제 1 예시' where episode_id=100",
      "update episodes set image_urls='[\"unverified.png\"]' where id=100"]){
      await db.exec('begin');await db.exec(query);const {packet}=await packetOf(db);
      const r=legacyImportTemplate(packet);approve(r);assert.equal(packet.entries.find(e=>e.episodeId==='100').eligible,false);
      assert.throws(()=>validateLegacyImport(packet,r),/SOURCE_NOT_ELIGIBLE/);await db.exec('rollback');
    }
  }finally{await db.close()}
});
test('evidence file path/bytes/hash verification is private and does not fabricate rights approval',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review);const valid=validateLegacyImport(packet,review);await mkdir('scratch/launch/backups',{recursive:true});
    const dir=await mkdtemp(path.resolve('scratch/launch/backups/stage24-evidence-'));await writeFile(path.join(dir,'rights.txt'),'proof');
    await verifyLegacyImportEvidence(dir,valid);
    await writeFile(path.join(dir,'rights.txt'),'wrong');await assert.rejects(verifyLegacyImportEvidence(dir,valid),/EVIDENCE_HASH_MISMATCH/);
    valid.cutoverEvidence={...proof,file:'../outside'};await assert.rejects(verifyLegacyImportEvidence(dir,valid));
  }finally{await db.close()}
});
test('future work publication is rejected by both packet and SQL before a direct episode can be exposed',async()=>{
  const f=await setup();const {db}=f;try{
    await db.exec("update works set published_at=now()+interval '2 days' where id=10");
    const {packet}=await packetOf(db),review=legacyImportTemplate(packet);approve(review);
    const row=packet.entries.find(e=>e.episodeId==='100');assert.equal(row.eligible,false);
    assert.ok(row.reasons.includes('PUBLIC_CLEAR_WORK_REQUIRED'));assert.throws(()=>validateLegacyImport(packet,review),/SOURCE_NOT_ELIGIBLE/);
    // Independently check SQL policy with current, hash-matching source rather than only a stale hash.
    const generated=legacyImportSql(packet,{selected:[{row,decision:review.decisions.find(d=>d.episodeId==='100')}],cutoverEvidence:proof},template);
    await db.exec("set webnovels.legacy_publication_import_verified='true'");await failsSql(db,generated.sql,/stale, unverified or invalid/);
    assert.equal((await f.content('100',reader)).error,'EPISODE_NOT_FOUND');
    assert.equal((await db.query('select count(*)::int n from authoring.publication_heads')).rows[0].n,0);
  }finally{await db.close()}
});
test('SQL requires operator verification and rejects stale source/owner/Auth/state/secure mirror atomically',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review);approve(review,large);const generated=legacyImportSql(packet,validateLegacyImport(packet,review),template);
    assert.equal(generated.sql.includes("set webnovels.legacy_publication_import_verified='true'"),false);
    await failsSql(db,generated.sql,/Verified database operator/);
    await db.exec("set webnovels.legacy_publication_import_verified='true'");
    for(const query of ["update episodes set title='changed' where id=100","update authors set auth_user_id=null where id=1",
      "update authoring.work_state set visibility='PRIVATE' where work_id=10",
      `update auth.users set email_confirmed_at=null where id='${admin}'`,
      "update secure_episode_contents set content='changed' where episode_id=100",
      "update episode_contents set text_content='changed' where episode_id=100"]){
      await db.exec('begin');await db.exec(query);const save=(await db.query('select to_jsonb(e)::text row from episodes e order by id')).rows;
      // Generated SQL begins its own transaction; use a savepoint to preserve the mutation for its CAS check.
      await db.exec('savepoint stale');await assert.rejects(db.exec(generated.sql.replace(/^([\s\S]*?)begin;/,'$1')),/stale|conflicts/);
      await db.exec('rollback to stale');assert.deepEqual((await db.query('select to_jsonb(e)::text row from episodes e order by id')).rows,save);
      assert.equal((await db.query('select count(*)::int n from authoring.publication_heads')).rows[0].n,0);await db.exec('rollback');
    }
  }finally{await db.close()}
});
test('approved SQL appends immutable public versions and original times; source/drafts/accounts/old heads remain exact',async()=>{
  const f=await setup();const {db}=f;try{
    await f.publish();const {snapshot,packet}=await packetOf(db),review=legacyImportTemplate(packet);
    approve(review);approve(review,large);
    const result=await rehearseLegacyImport(db,snapshot,packet,validateLegacyImport(packet,review),template);
    assert.ok(result.report.preservedRows>0);assert.equal(result.report.privateImmutableArchive,true);assert.equal(result.report.replayRejected,true);
    const version=(await db.query('select e.id::text id,v.source_draft_id,v.source_revision,v.content,v.image_urls from episodes e join authoring.publication_heads h on h.episode_id=e.id join authoring.publication_versions v on v.id=h.version_id where e.work_id=10 order by e.id')).rows;
    assert.deepEqual(version.map(v=>v.id),['100',large]);assert.equal(version[0].content,'Original body');assert.equal(version[1].source_draft_id,null);
    assert.deepEqual(version[1].image_urls,[]);
    assert.deepEqual((await db.query('select distinct kind from growth.publication_activity where work_id=10')).rows,[{kind:'BASELINE'}]);
    const content=await f.content('100',reader);assert.ok(content.episode,JSON.stringify(content));
    assert.equal(content.episode.content,'Original body');
    const edit=(await db.query("select public.creator_publications($1,'begin-edit',$2,$3,$4,'{}'::jsonb,$5) result",[admin,'10',crypto.randomUUID(),'100',crypto.randomUUID()])).rows[0].result;
    assert.ok(edit.draft,JSON.stringify(edit));assert.equal(edit.draft.content,'Original body');
    const next=await packetOf(db);assert.equal(next.packet.entries.find(e=>e.episodeId==='100').eligible,false);
    assert.ok(next.packet.entries.find(e=>e.episodeId==='100').reasons.includes('EXISTING_HEAD_PRESERVED'));
  }finally{await db.close()}
});
test('active schedule and existing publication preserve their original versions; app roles cannot execute import',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review);const generated=legacyImportSql(packet,validateLegacyImport(packet,review),template);
    await db.exec(`insert into authoring.publication_versions(episode_id,work_id,title,content) values(100,10,'예약','보존 버전');
      insert into authoring.schedules(episode_id,version_id,due_at)
        select episode_id,id,now()+interval '1 day' from authoring.publication_versions where episode_id=100;`);
    const next=await packetOf(db);assert.ok(next.packet.entries.find(e=>e.episodeId==='100').reasons.includes('ACTIVE_SCHEDULE_PRESERVED'));
    await db.exec("set webnovels.legacy_publication_import_verified='true'");await failsSql(db,generated.sql,/stale/);
    assert.equal((await db.query('select count(*)::int n from authoring.publication_versions')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from authoring.publication_heads')).rows[0].n,0);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('set role '+role);await failsSql(db,generated.sql,/Verified database operator/);await db.exec('reset role');
    }
  }finally{await db.close()}
});
test('a head trigger that changes original work metadata causes the entire import to roll back',async()=>{
  const {db,packet,review}=await setup();try{
    approve(review);const generated=legacyImportSql(packet,validateLegacyImport(packet,review),template);
    await db.exec(`create function public.synthetic_import_side_effect() returns trigger language plpgsql as $$
      begin update public.works set description='unexpected side effect' where id=(select work_id from public.episodes where id=new.episode_id);return new;end $$;
      create trigger synthetic_import_side_effect after insert on authoring.publication_heads
        for each row execute function public.synthetic_import_side_effect();
      set webnovels.legacy_publication_import_verified='true';`);
    await failsSql(db,generated.sql,/Unexpected imported source mutation/);
    assert.equal((await db.query('select title from episodes where id=100')).rows[0].title,'Original');
    assert.equal((await db.query('select description from works where id=10')).rows[0].description,'소개');
    assert.equal((await db.query('select count(*)::int n from authoring.publication_heads')).rows[0].n,0);
    assert.equal((await db.query("select to_regclass('launch_recovery.legacy_publication_imports') table_name")).rows[0].table_name,null);
  }finally{await db.close()}
});
