import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup as foundation,admin,reader,limited} from './stage17-db.mjs';
export {admin,reader,limited};
export const otherReader='44444444-4444-4444-8444-444444444444';
export const uuid=()=>crypto.randomUUID();
const read=file=>readFile(new URL('../../'+file,import.meta.url),'utf8');
export const sql=await read('database/launch/019_points_test.sql');
export async function setup({seed=true,dbFactory}={}){
 const {db}=await foundation({dbFactory});
 try{
  for(const file of ['database/authoring/015_webtoon.sql','database/authoring/021_manuscript_documents.sql'])await db.exec(await read(file));
  // Reproduce the explicit-ACL future baseline rather than relying on automatic grants.
  await db.exec("alter default privileges revoke all on tables from anon,authenticated,service_role;alter default privileges revoke execute on functions from public;set webnovels.points_test_apply_verified='true'");
  await db.exec("create schema commerce;grant usage on schema commerce to service_role,authenticated;create table commerce.legacy_sentinel(id integer primary key,label text);insert into commerce.legacy_sentinel values(1,'existing TEST evidence');grant select on commerce.legacy_sentinel to service_role;create function commerce.legacy_marker() returns text language sql as $$select 'legacy-preserved'::text$$;grant execute on function commerce.legacy_marker() to service_role");
  const baselineCommerce=(await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0];
  await db.exec(sql);
  assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0],baselineCommerce);
  await db.query('insert into auth.users(id) values($1)',[otherReader]);
  await db.query("insert into public.readers(id,auth_user_id,status) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,'ACTIVE')",[otherReader]);
  const call=async(action,data={},user=reader)=>(await db.query('select public.op04_points_test($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const adminCall=(action,data={})=>call('admin-'+action,data,admin);
  const state=()=>adminCall('state');
  const enroll=async(workId,enabled=true,changes={})=>adminCall('enroll',{workId,enabled,revision:(await state()).revision,reason:'명시적 TEST 작품 등록',requestId:uuid(),...changes});
  const policy=async(scope='DEFAULT',targetId=null,points=100,changes={})=>adminCall('policy',{scope,targetId,points,startsAt:new Date(Date.now()-1000).toISOString(),revision:(await state()).revision,reason:'명시적 TEST 가격 변경',requestId:uuid(),...changes});
  const credit=(points=1000,targetUserId=reader,changes={})=>adminCall('credit',{targetUserId,points,reason:'명시적 TEST 포인트 지급',requestId:uuid(),...changes});
  const quote=(episodeId,user=reader)=>call('quote',{episodeId},user);
  const purchase=(quoteId,requestId=uuid(),user=reader)=>call('purchase',{quoteId,requestId},user);
  const content=(episodeId,user=reader)=>call('content',{episodeId},user);
  const panel=(episodeId,versionId,panelId,format='webp',user=reader)=>call('panel',{episodeId,versionId,panelId,format},user);
  const assetCall=async(action,work,id,data={})=>(await db.query('select public.creator_webtoon($1,$2,$3,$4,$5) result',[admin,action,work,id,JSON.stringify(data)])).rows[0].result;
  async function readyAsset(workId){
   const id=uuid(),sha='a'.repeat(64),metadata={name:'TEST 이미지.png',sha,bytes:1000,mime:'image/png',width:800,height:1000};
   assert.equal((await assetCall('prepare',workId,id,metadata)).asset?.state,'PREPARED');
   await assetCall('uploaded',workId,id);const job=await assetCall('claim',workId,id);
   assert.equal((await assetCall('part',workId,id,{lease:job.lease,part:0,width:800,height:1000,webpSha:sha,pngSha:'b'.repeat(64)})).asset?.state,'READY');
   return id;
  }
  async function makeWork(type='NOVEL',count=3){
   const created=(await db.query("select public.creator_works($1,'create',null,$2,$3) result",[admin,JSON.stringify({title:type==='WEBTOON'?'OP-04 TEST 웹툰':'OP-04 TEST 소설',contentType:type}),uuid()])).rows[0].result;
   assert.ok(created.work,JSON.stringify(created));const workId=created.work.id;
   await db.query("update public.works set description='합성 TEST 전용 소개',genre=array['판타지'] where id=$1",[workId]);
   await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[workId]);
   const episodes=[];
   for(let number=1;number<=count;number++){
    const draftId=uuid(),assetId=type==='WEBTOON'?await readyAsset(workId):null;
    const data={title:number+'화 TEST',content:type==='NOVEL'?'시험용 '+number+'화 본문입니다.':'',authorComment:'',expectedRevision:'0',...(assetId?{webtoon:{schemaVersion:1,assetIds:[assetId],thumbnailAssetId:assetId,credits:{writer:'TEST 글',artist:'TEST 그림',original:''}}}:{})};
    const saved=(await db.query("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[admin,workId,draftId,JSON.stringify(data),uuid()])).rows[0].result;
    assert.ok(saved.draft,JSON.stringify(saved));
    const publication=(await db.query("select public.creator_publications_v18($1,'publish',$2,$3,null,$4,$5) result",[admin,workId,draftId,JSON.stringify({revision:'1',episodeNumber:number,mode:'NOW',rightsConfirmed:true}),uuid()])).rows[0].result;
    assert.ok(publication.publication,JSON.stringify(publication));
    const p=publication.publication;
    episodes.push({id:p.episodeId,versionId:p.versionId,number,draftId,assetId,...(assetId?{panelId:(await db.query('select id from authoring.webtoon_panels where asset_id=$1',[assetId])).rows[0].id}:{})});
   }
   assert.equal((await enroll(workId)).saved,true);
   return {id:workId,type,episodes};
  }
  async function replaceHead(episode,{title='승인된 TEST 수정 본문',newAsset=false,contentDocument=null}={}){
   const row=(await db.query('select e.work_id,v.* from public.episodes e join authoring.publication_heads h on h.episode_id=e.id join authoring.publication_versions v on v.id=h.version_id where e.id=$1',[episode.id])).rows[0];
   const id=uuid();let manifest=row.webtoon,sourceDraft=null,sourceRevision=null;
   if(newAsset){const assetId=await readyAsset(String(row.work_id));manifest={...manifest,assetIds:[assetId],thumbnailAssetId:assetId};}
   if(contentDocument){
    sourceDraft=uuid();const opened=(await db.query("select public.creator_publications_v18($1,'begin-edit',$2,$3,$4,'{}',$5) result",[admin,row.work_id,sourceDraft,episode.id,uuid()])).rows[0].result;assert.ok(opened.draft,JSON.stringify(opened));
    const saved=(await db.query("select public.creator_drafts($1,'save',$2,$3,$4,$5) result",[admin,row.work_id,sourceDraft,JSON.stringify({title,content:title,authorComment:row.author_comment,expectedRevision:opened.draft.revision,contentDocument}),uuid()])).rows[0].result;assert.ok(saved.draft,JSON.stringify(saved));sourceRevision=saved.draft.revision;
   }
   // A synthetic approved replacement of a current immutable head; no author-review bypass is exposed by OP-04.
   await db.query('insert into authoring.publication_versions(id,episode_id,work_id,title,content,author_comment,image_urls,webtoon,content_document,source_draft_id,source_revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,episode.id,row.work_id,title,row.webtoon?'':title,row.author_comment,JSON.stringify(row.image_urls),manifest?JSON.stringify(manifest):null,contentDocument?JSON.stringify(contentDocument):null,sourceDraft,sourceRevision]);
   await db.query('update authoring.publication_heads set version_id=$1,published_at=now() where episode_id=$2',[id,episode.id]);
   const panelId=manifest?(await db.query('select id from authoring.webtoon_panels where asset_id=$1',[manifest.assetIds[0]])).rows[0].id:null;
   return {id:episode.id,versionId:id,panelId};
  }
  async function expiredQuote(quoteId){
   const id=uuid();await db.query("insert into commerce.op04_quotes(id,user_id,episode_id,work_id,publication_id,price_id,points,created_at,expires_at) select $1,user_id,episode_id,work_id,publication_id,price_id,points,now()-interval '10 minutes',now()-interval '5 minutes' from commerce.op04_quotes where id=$2",[id,quoteId]);return id;
  }
  const novel=seed?await makeWork('NOVEL'):null,webtoon=seed?await makeWork('WEBTOON'):null;
  return {db,call,adminCall,state,enroll,policy,credit,quote,purchase,content,panel,makeWork,replaceHead,expiredQuote,novel,webtoon,baselineCommerce};
 }catch(error){await db.close();throw error;}
}
