import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader,limited} from './fixtures/stage17-db.mjs';

// Local PostgreSQL fixture only. Never reads environment files or hosted data.
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8'),owner=reader,uid=()=>crypto.randomUUID(),j=JSON.stringify;
let db;
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const rpc=async(name,args)=>(await rows(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
const workspace=(work,episode=null,user=owner)=>rpc('creator_episode_workspace',[user,work,episode]);
const save=(work,id,data={})=>rpc('creator_drafts',[owner,'save',work,id,j({expectedRevision:'0',title:'첫 회차',content:'발행 본문',authorComment:'작가의 말',...data}),uid()]);
const publish=(work,id,number=1,mode='NOW',revision='1')=>rpc('creator_publications_v18',[owner,'publish',work,id,null,j({revision,episodeNumber:number,mode,rightsConfirmed:true,...(mode==='SCHEDULED'?{dueAt:new Date(Date.now()+3600000).toISOString(),displayTimezone:'Asia/Seoul'}:{})}),uid()]);
before(async()=>{
  ({db}=await setup());
  for(const migration of ['015_webtoon','021_manuscript_documents','022_publication_change_review','028_publication_history_contract','029_publication_change_work_scope'])await db.exec(await read('database/authoring/'+migration+'.sql'));
  await db.exec('alter default privileges in schema public revoke all on tables from anon,authenticated,service_role; alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role');
  await db.exec(await read('database/authoring/030_creator_episode_workspace.sql'));
});
after(async()=>db?.close());
async function work(type='NOVEL'){
  const created=await rpc('creator_works',[owner,'create',null,j({title:'CMS 인수 '+type,contentType:type}),uid()]);assert.ok(created.work,j(created));
  const id=created.work.id;
  await db.query("update works set description='소개',genre=array['로맨스'] where id=$1",[id]);
  await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[id]);return id;
}
async function webtoonAsset(work){
  const id=uid(),call=(action,data={})=>rpc('creator_webtoon',[owner,action,work,id,j(data)]);
  await call('prepare',{name:'첫 그림.png',sha:'a'.repeat(64),bytes:1000,mime:'image/png',width:800,height:1000});await call('uploaded');
  const claimed=await call('claim');const result=await call('part',{lease:claimed.lease,part:0,width:800,height:1000,webpSha:'b'.repeat(64),pngSha:'c'.repeat(64)});assert.equal(result.asset.state,'READY');return id;
}

test('owner list counts real member-hour events once, excludes author and other works, and has no invented legacy views',async()=>{
  const w=await work(),draft=uid();assert.ok((await save(w,draft)).draft);const pub=(await publish(w,draft)).publication;
  const next=uid();await save(w,next);const reservation=(await publish(w,next,2,'SCHEDULED')).publication;
  await db.query('update episodes set view_count=999999 where id=$1',[pub.episodeId]);
  await db.query(`insert into authoring.reader_events_v2(user_id,work_id,episode_id,event_type,bucket) values
    ($1,$4,$5,'OPEN','2026-10-30 12:00Z'),($1,$4,$5,'COMPLETE','2026-10-30 12:00Z'),
    ($1,$4,$5,'OPEN','2026-10-30 13:00Z'),($2,$4,$5,'COMPLETE','2026-10-30 12:00Z'),
    ($3,$4,$5,'OPEN','2026-10-30 12:00Z'),($1,10,100,'OPEN','2026-10-30 12:00Z')`,[admin,limited,owner,w,pub.episodeId]);
  const list=await workspace(w);assert.equal(list.workId,w);assert.equal(list.contentType,'NOVEL');assert.equal(list.episodes.length,2);
  const first=list.episodes[0],second=list.episodes[1];
  assert.equal(first.member_read_count,'3');assert.equal(first.has_head,true);assert.equal(first.versionId,pub.versionId);assert.equal(Date.parse(first.published_at),Date.parse(pub.publishedAt));
  assert.equal(second.id,reservation.episodeId);assert.equal(second.member_read_count,'0');assert.equal(second.has_head,false);assert.equal(second.published_at,null);assert.equal(second.schedule_status,'PENDING');
  assert.equal((await workspace(w,pub.episodeId)).episode.member_read_count,'3');
  assert.equal((await workspace(w,reservation.episodeId)).error,'PUBLICATION_NOT_FOUND');
  for(const secret of [owner,admin,limited,'발행 본문','999999'])assert.ok(!j(list).includes(secret));
});

test('novel inspection is read-only and reads current immutable published Word formatting even when private and an edit awaits approval',async()=>{
  const w=await work(),id=uid(),document={version:1,paragraphs:[{align:'center',indent:0,runs:[{text:'발행 본문',bold:true}]}]};
  await save(w,id,{contentDocument:document});const pub=(await publish(w,id)).publication;
  const edited=await rpc('creator_publications_v18',[owner,'begin-edit',w,uid(),pub.episodeId,'{}',uid()]);assert.ok(edited.draft);
  await save(w,edited.draft.id,{expectedRevision:'1',title:'승인 대기 제목',content:'공개하면 안 되는 수정 내용'});
  const review=await publish(w,edited.draft.id,1,'NOW','2');assert.equal(review.reviewRequired,true);
  await db.query("update works set status='DRAFT' where id=$1",[w]);await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w]);
  await db.query("update episodes set status='DRAFT' where id=$1",[pub.episodeId]);
  const before=(await rows('select count(*)::int n from authoring.drafts'))[0].n;
  for(let i=0;i<2;i++){
    const result=await workspace(w,pub.episodeId);assert.equal(result.episode.title,'첫 회차');assert.equal(result.episode.content,'발행 본문');
    assert.deepEqual(result.episode.contentDocument,document);assert.equal(result.episode.versionId,pub.versionId);assert.equal(result.episode.status,'DRAFT');assert.ok(!j(result).includes('공개하면 안 되는'));
  }
  assert.equal((await rows('select count(*)::int n from authoring.drafts'))[0].n,before,'reading must not create an editing draft');
  assert.equal((await rows('select version_id from authoring.publication_heads where episode_id=$1',[pub.episodeId]))[0].version_id,pub.versionId);
});

test('webtoon owner snapshot retains published image order and credits rather than a later editing manifest',async()=>{
  const w=await work('WEBTOON'),first=await webtoonAsset(w),second=await webtoonAsset(w),id=uid();
  const webtoon={schemaVersion:1,assetIds:[second,first],thumbnailAssetId:second,credits:{writer:'글 작가',artist:'그림 작가',original:'원작 작가'}};
  await save(w,id,{content:'',webtoon});const pub=(await publish(w,id)).publication;assert.ok(pub,j(pub));
  const edited=await rpc('creator_publications_v18',[owner,'begin-edit',w,uid(),pub.episodeId,'{}',uid()]);
  await save(w,edited.draft.id,{expectedRevision:'1',content:'',webtoon:{...webtoon,assetIds:[first]}});
  const result=await workspace(w,pub.episodeId);assert.equal(result.episode.contentType,'WEBTOON');
  assert.deepEqual(result.episode.webtoon.panels.map(panel=>panel.assetId),[second,first]);assert.deepEqual(result.episode.webtoon.credits,webtoon.credits);
  assert.ok(!/bucket|source|sha|\/storage\//i.test(j(result)));assert.equal(result.episode.webtoon.panels[0].width,800);
});

test('service-only explicit EXECUTE, ownership, account state, missing-head and cross-work guards survive actual SET ROLE and reapply',async()=>{
  const w=await work(),id=uid();await save(w,id);const pub=(await publish(w,id)).publication;
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);
    try{
      if(role==='service_role'){
        assert.equal((await workspace(w)).episodes[0].id,pub.episodeId);assert.equal((await workspace(w,pub.episodeId)).episode.content,'발행 본문');
        assert.equal((await workspace(w,null,admin)).error,'WORK_NOT_FOUND');assert.equal((await workspace(w,'100')).error,'PUBLICATION_NOT_FOUND');
      }else await assert.rejects(workspace(w),error=>error.code==='42501');
    }finally{await db.exec('reset role');}
  }
  await db.query("update authors set status='SUSPENDED' where auth_user_id=$1",[owner]);
  assert.equal((await workspace(w)).error,'AUTHOR_REQUIRED');await db.query("update authors set status='APPROVED' where auth_user_id=$1",[owner]);
  await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[owner]);
  assert.equal((await workspace(w)).error,'ACCOUNT_INACTIVE');await db.query('update auth.users set banned_until=null where id=$1',[owner]);
  assert.equal((await workspace(w,null,null)).error,'INVALID_ID');
  const before=await workspace(w);await db.exec(await read('database/authoring/030_creator_episode_workspace.sql'));assert.deepEqual(await workspace(w),before);
  const acl=(await rows("select has_function_privilege('anon','public.creator_episode_workspace(uuid,bigint,bigint)','EXECUTE') anon,has_function_privilege('authenticated','public.creator_episode_workspace(uuid,bigint,bigint)','EXECUTE') authenticated,has_function_privilege('service_role','public.creator_episode_workspace(uuid,bigint,bigint)','EXECUTE') service"))[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
});
