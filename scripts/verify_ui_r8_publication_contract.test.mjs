import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';

// Isolated PostgreSQL only: no environment files, network, hosted DB or activation.
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8'),uid=()=>crypto.randomUUID(),j=JSON.stringify;
const owner=reader,migration=await read('database/authoring/028_publication_history_contract.sql');let db,baseline;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const rpc=async(name,args)=>(await query(`select public.${name}(${args.map((_value,index)=>'$'+(index+1)).join(',')}) result`,args))[0].result;
const publish=(work,id,{revision='1',number=1,mode='NOW',key=uid(),user=owner}={})=>rpc('creator_publications_v18',[user,'publish',work,id,null,j({revision,episodeNumber:number,mode,rightsConfirmed:true,...(mode==='SCHEDULED'?{dueAt:new Date(Date.now()+3600000).toISOString(),displayTimezone:'Asia/Seoul'}:{})}),key]);
const publicationAction=(work,action,episode,data={},user=owner)=>rpc('creator_publications_v18',[user,action,work,null,episode,j(data),null]);
const getDraft=(work,id,user=owner)=>rpc('creator_drafts',[user,'get',work,id]);
const save=(work,id,{revision='0',title='실제 원고',content='공개 전 원고',webtoon=null}={})=>rpc('creator_drafts',[owner,'save',work,id,j({expectedRevision:revision,title,content,authorComment:'',...(webtoon?{webtoon}: {})}),uid()]);

before(async()=>{
  ({db}=await setup());
  for(const name of ['015_webtoon','021_manuscript_documents','022_publication_change_review'])await db.exec(await read('database/authoring/'+name+'.sql'));
  const w=await work(),draft=await manuscript(w,'NOVEL'),published=(await publish(w,draft.id)).publication;
  baseline={work:w,draftId:draft.id,versionId:published.versionId,draft:(await getDraft(w,draft.id)).draft,
    publication:(await query('select authoring.publication_json($1) result',[published.versionId]))[0].result};
  await db.exec(migration);
  assert.equal((await query('select count(*)::int n from admin_users where auth_user_id=$1',[owner]))[0].n,0,'the author under test has no admin profile');
});
after(async()=>db?.close());

async function work(type='NOVEL'){
  const result=await rpc('creator_works',[owner,'create',null,j({title:'작가 권한 경계 '+type,contentType:type}),uid()]);assert.ok(result.work,j(result));
  const id=result.work.id;await db.query("update public.works set description='공개 소개',genre=array['로맨스'] where id=$1",[id]);
  await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[id]);return id;
}
async function asset(work){
  const id=uid(),call=(action,data={})=>rpc('creator_webtoon',[owner,action,work,id,j(data)]);
  await call('prepare',{name:'원고.png',sha:'a'.repeat(64),bytes:1000,mime:'image/png',width:800,height:1000});await call('uploaded');
  const claim=await call('claim'),ready=await call('part',{lease:claim.lease,part:0,width:800,height:1000,webpSha:'b'.repeat(64),pngSha:'c'.repeat(64)});assert.equal(ready.asset.state,'READY',j(ready));return ready.asset.id;
}
const manifest=ids=>({schemaVersion:1,assetIds:ids,thumbnailAssetId:ids[0],credits:{writer:'글',artist:'그림',original:''}});
async function manuscript(work,type,{revision='0',id=uid(),modified=false}={}){
  const result=await save(work,id,{revision,title:modified?'수정한 회차':'첫 회차',...(type==='WEBTOON'?{content:'',webtoon:manifest([await asset(work)])}:{content:modified?'수정한 비공개 본문':'최초 공개 본문'})});assert.ok(result.draft,j(result));return result.draft;
}
const pendingCount=async work=>(await query('select count(*)::int n from authoring.publication_changes where work_id=$1',[work]))[0].n;

for(const type of ['NOVEL','WEBTOON']){
  test(type+': an ordinary author publishes first and next episodes immediately, with exact per-episode history and replay',async()=>{
    const w=await work(type),first=await manuscript(w,type);assert.equal(first.hasPublicationHistory,false);
    const published=await publish(w,first.id);assert.equal(published.publication.status,'PUBLISHED',j(published));assert.equal(published.publication.hasPublicationHistory,true);
    const next=await manuscript(w,type);assert.equal(next.hasPublicationHistory,false,'another public episode does not make this new draft public');
    const key=uid(),second=await publish(w,next.id,{number:2,key});assert.equal(second.publication.status,'PUBLISHED',j(second));
    assert.deepEqual(await publish(w,next.id,{number:2,key}),second,'lost-response retry preserves publication identity');
    assert.equal(await pendingCount(w),0);assert.equal((await getDraft(w,next.id)).draft.hasPublicationHistory,true);
  });

  test(type+': a never-public reservation can be moved, cancelled, revised and immediately published without approval',async()=>{
    const w=await work(type),draft=await manuscript(w,type),scheduled=await publish(w,draft.id,{mode:'SCHEDULED'}),ep=scheduled.publication.episodeId;
    assert.equal(scheduled.publication.status,'SCHEDULED',j(scheduled));assert.equal(scheduled.publication.hasPublicationHistory,false);
    assert.equal((await query('select status from episodes where id=$1',[ep]))[0].status,'DRAFT');
    assert.equal((await query('select count(*)::int n from authoring.publication_heads where episode_id=$1',[ep]))[0].n,0);
    assert.equal((await query('select count(*)::int n from authoring.publication_history where work_id=$1',[w]))[0].n,0);
    assert.equal((await save(w,draft.id,{revision:'1',content:type==='WEBTOON'?'':'다른 원고'})).error,'DRAFT_READ_ONLY','pinned snapshot remains immutable until cancellation');
    const moved=await publicationAction(w,'reschedule',ep,{generation:1,dueAt:new Date(Date.now()+7200000).toISOString(),displayTimezone:'Asia/Seoul'});assert.equal(moved.publication.generation,2,j(moved));assert.equal(moved.publication.hasPublicationHistory,false);
    assert.equal((await publicationAction(w,'cancel',ep,{generation:1})).error,'SCHEDULE_CONFLICT');
    const cancelled=await publicationAction(w,'cancel',ep,{generation:2});assert.equal(cancelled.publication.status,'CANCELLED',j(cancelled));assert.equal(cancelled.publication.hasPublicationHistory,false);
    const restored=(await getDraft(w,draft.id)).draft;assert.equal(restored.lifecycle,'ACTIVE');assert.equal(restored.episodeId,ep);assert.equal(restored.hasPublicationHistory,false);
    const revised=await manuscript(w,type,{id:draft.id,revision:'1',modified:true}),immediate=await publish(w,revised.id,{revision:'2'});
    assert.equal(immediate.publication.status,'PUBLISHED',j(immediate));assert.equal(immediate.publication.episodeId,ep);assert.equal(immediate.publication.hasPublicationHistory,true);assert.equal(await pendingCount(w),0);
  });

  test(type+': a new reservation on a public work bypasses review, but public content replacement waits for a different administrator',async()=>{
    const w=await work(type),first=await manuscript(w,type),published=(await publish(w,first.id)).publication;
    const next=await manuscript(w,type),scheduled=await publish(w,next.id,{number:2,mode:'SCHEDULED'});assert.equal(scheduled.publication.status,'SCHEDULED',j(scheduled));assert.equal(scheduled.publication.hasPublicationHistory,false);assert.equal(await pendingCount(w),0);
    const third=await manuscript(w,type),failed=await publish(w,third.id,{number:3,mode:'SCHEDULED'});
    await db.query("update authoring.schedules set due_at=now()-interval '1 minute' where id=$1",[failed.publication.scheduleId]);
    await db.query("update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='합성 검증 제한' where work_id=$1",[w]);
    try{const ran=await rpc('run_creator_schedules_v18',[20]);assert.equal(ran.failedOrRetrying,1,j(ran));}
    finally{await db.query("update authoring.work_state set moderation_state='CLEAR',moderation_reason=null where work_id=$1",[w]);}
    const editId=uid(),opened=await rpc('creator_publications_v18',[owner,'begin-edit',w,editId,published.episodeId,'{}',uid()]);assert.ok(opened.draft,j(opened));assert.equal(opened.draft.hasPublicationHistory,true);
    await manuscript(w,type,{id:editId,revision:'1',modified:true});
    const key=uid(),review=await publish(w,editId,{revision:'2',key});assert.equal(review.reviewRequired,true,j(review));assert.deepEqual(await publish(w,editId,{revision:'2',key}),review);
    const rows=(await publicationAction(w,'list',null)).publications;assert.equal(rows.find(item=>item.versionId===published.versionId).status,'PUBLISHED');assert.equal(rows.find(item=>item.versionId===published.versionId).hasPublicationHistory,true);assert.equal(rows.find(item=>item.episodeId===scheduled.publication.episodeId).hasPublicationHistory,false);
    assert.equal(rows.find(item=>item.episodeId===scheduled.publication.episodeId).status,'SCHEDULED');
    const failedRow=rows.find(item=>item.episodeId===failed.publication.episodeId);assert.equal(failedRow.status,'FAILED');assert.equal(failedRow.hasPublicationHistory,false);assert.equal(failedRow.lastErrorCode,'WORK_UNAVAILABLE');
    const denied=await rpc('admin_publication_changes',[owner,'decide',j({changeId:review.changeId,decision:'APPROVE',reason:'작가 자가 승인 시도'})]);assert.equal(denied.error,'ADMIN_REQUIRED');
    const before=(await query('select version_id from authoring.publication_heads where episode_id=$1',[published.episodeId]))[0].version_id;assert.equal(before,published.versionId);
    const approved=await rpc('admin_publication_changes',[admin,'decide',j({changeId:review.changeId,decision:'APPROVE',reason:'공개 변경 검토 완료'})]);assert.equal(approved.decision,'APPROVE',j(approved));
    assert.notEqual((await query('select version_id from authoring.publication_heads where episode_id=$1',[published.episodeId]))[0].version_id,before);
  });
}

test('foreign author, suspended account, stale revision and browser roles cannot cross ownership or mutate a pinned snapshot',async()=>{
  const w=await work(),draft=await manuscript(w,'NOVEL');
  assert.equal((await publish(w,draft.id,{user:admin})).error,'WORK_NOT_FOUND');assert.equal((await getDraft(w,draft.id,admin)).error,'WORK_NOT_FOUND');assert.equal((await publish(w,draft.id,{revision:'999'})).error,'DRAFT_REVISION_CONFLICT');
  await db.query("update authors set status='SUSPENDED' where auth_user_id=$1",[owner]);
  try{assert.equal((await publish(w,draft.id)).error,'AUTHOR_REQUIRED');}finally{await db.query("update authors set status='APPROVED' where auth_user_id=$1",[owner]);}
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);
    try{
      await assert.rejects(db.query('select authoring.draft_json($1,1)',[draft.id]),error=>error.code==='42501');
      await assert.rejects(db.query('select authoring.publication_json($1)',[baseline.versionId]),error=>error.code==='42501');
      if(role!=='service_role'){await assert.rejects(getDraft(w,draft.id),error=>error.code==='42501');await assert.rejects(publish(w,draft.id),error=>error.code==='42501');await assert.rejects(publicationAction(w,'list',null),error=>error.code==='42501');}
      else {assert.equal((await getDraft(w,draft.id)).draft.hasPublicationHistory,false,'service-only wrapper retains its intended permission');assert.deepEqual((await publicationAction(w,'list',null)).publications,[]);}
    }finally{await db.exec('reset role');}
  }
  assert.equal((await query('select count(*)::int n from authoring.publication_versions where work_id=$1',[w]))[0].n,0);
});

test('history metadata remains truthful after approved withdrawal and migration replay preserves every existing response field',async()=>{
  const migratedDraft=(await getDraft(baseline.work,baseline.draftId)).draft;
  const migratedPublication=(await query('select authoring.publication_json($1) result',[baseline.versionId]))[0].result;
  assert.equal(migratedDraft.hasPublicationHistory,true);assert.equal(migratedPublication.hasPublicationHistory,true);
  delete migratedDraft.hasPublicationHistory;delete migratedPublication.hasPublicationHistory;
  assert.deepEqual(migratedDraft,baseline.draft,'all pre-migration draft fields remain identical');
  assert.deepEqual(migratedPublication,baseline.publication,'all pre-migration publication fields remain identical');
  const w=await work(),draft=await manuscript(w,'NOVEL'),published=(await publish(w,draft.id)).publication;
  const withdrawal=await rpc('stage8_creator',[owner,'withdraw',w,j({episodeId:published.episodeId})]);assert.equal(withdrawal.reviewRequired,true,j(withdrawal));
  const approved=await rpc('admin_publication_changes',[admin,'decide',j({changeId:withdrawal.changeId,decision:'APPROVE',reason:'공개 중단 검토 완료'})]);assert.equal(approved.decision,'APPROVE',j(approved));
  assert.equal((await getDraft(w,draft.id)).draft.hasPublicationHistory,true,'withdrawal never turns old public material into a first publication');
  const before={draft:await getDraft(w,draft.id),publications:await publicationAction(w,'list',null)};await db.exec(migration);await db.exec(migration);
  assert.deepEqual({draft:await getDraft(w,draft.id),publications:await publicationAction(w,'list',null)},before);
  assert.equal((await query("select count(*)::int n from authoring.migrations where version='authoring-028'"))[0].n,1);
  const settings=await query("select proconfig from pg_proc where oid in ('authoring.draft_json(uuid,bigint)'::regprocedure,'authoring.publication_json(uuid)'::regprocedure)");assert.equal(settings.length,2);assert(settings.every(row=>row.proconfig.includes('search_path=""')));
});

test('migration refuses a drifted publication implementation instead of replacing an unexpected function body',async()=>{
  const original=(await query("select pg_get_functiondef('authoring.review_original_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid)'::regprocedure) definition"))[0].definition;
  const changed=original.replace('where list_version.work_id=w.id','where list_version.work_id = w.id');assert.notEqual(changed,original);
  try{
    await db.exec(changed);
    await assert.rejects(db.exec(migration),/Unexpected original publication list definition; review before applying/);
  }finally{await db.exec('rollback');await db.exec(original);}
  assert.equal((await publicationAction(baseline.work,'list',null)).publications[0].hasPublicationHistory,true);
  assert.equal((await query("select count(*)::int n from authoring.migrations where version='authoring-028'"))[0].n,1);
});
