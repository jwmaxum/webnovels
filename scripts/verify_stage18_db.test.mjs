import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';
let db;const sql=await readFile(new URL('../database/authoring/015_webtoon.sql',import.meta.url),'utf8');
before(async()=>{({db}=await setup());await db.exec(sql);});after(async()=>db?.close());
const uid=()=>crypto.randomUUID(),json=x=>JSON.stringify(x),sha='a'.repeat(64);
const query=async(sql,args)=>(await db.query(sql,args)).rows[0]?.result;
const asset=(work,action,id,data={},user=admin)=>query('select public.creator_webtoon($1,$2,$3,$4,$5) result',[user,action,work,id,json(data)]);
const metadata={name:'원본.png',sha,bytes:1000,mime:'image/png',width:800,height:5000};
const manifest=ids=>({schemaVersion:1,assetIds:ids,thumbnailAssetId:ids[0]||null,credits:{writer:'글',artist:'그림',original:''}});
const save=(work,id,m,revision='0',key=uid())=>query('select public.creator_drafts($1,$2,$3,$4,$5,$6) result',[admin,'save',work,id,json({title:'첫 회',content:'',authorComment:'감사합니다',expectedRevision:revision,webtoon:m}),key]);
const publish=(work,draft,{mode='NOW',revision='1',key=uid(),number=1}={})=>query('select public.creator_publications_v18($1,$2,$3,$4,null,$5,$6) result',[admin,'publish',work,draft,json({revision,episodeNumber:number,mode,rightsConfirmed:true,...(mode==='SCHEDULED'?{dueAt:new Date(Date.now()+3600000).toISOString(),displayTimezone:'Asia/Seoul'}:{})}),key]);
async function work(type='WEBTOON',key=uid()){
 const r=await query('select public.creator_works($1,$2,null,$3,$4) result',[admin,'create',json({title:'새 작품',contentType:type}),key]);assert.ok(r.work,JSON.stringify(r));
 await db.query("update works set description='소개',genre=array['판타지'] where id=$1",[r.work.id]);
 await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[r.work.id]);return r.work.id;
}
async function ready(w){
 const id=uid();assert.equal((await asset(w,'prepare',id,metadata)).asset.state,'PREPARED');await asset(w,'uploaded',id);
 for(let i=0;i<2;i++){const job=await asset(w,'claim',id);const r=await asset(w,'part',id,{lease:job.lease,part:i,width:800,height:i?904:4096,webpSha:sha,pngSha:'b'.repeat(64)});assert.ok(r.asset,JSON.stringify(r));}
 return (await asset(w,'get',id)).asset;
}
async function published(){const w=await work(),a=await ready(w),d=uid();assert.ok((await save(w,d,manifest([a.id]))).draft);const p=await publish(w,d);assert.ok(p.publication,JSON.stringify(p));return {w,a,d,p:p.publication};}

test('migration is repeatable, private tables/RPC and storage policies reject client roles',async()=>{
 await db.exec(sql);for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from authoring.webtoon_assets'));await assert.rejects(asset('10','list',null));await assert.rejects(query('select public.stage18_image(1,$1,$2,$3) result',[uid(),uid(),'png']));await db.exec('reset role');}
 assert.equal((await db.query("select public from storage.buckets where id='authoring-webtoons'")).rows[0].public,false);
});
test('work type is immutable and part of creation idempotency; defaults remain NOVEL',async()=>{
 const key=uid(),w=await work('WEBTOON',key);
 const again=await query('select public.creator_works($1,$2,null,$3,$4) result',[admin,'create',json({title:'새 작품',contentType:'WEBTOON'}),key]);assert.equal(again.work.id,w);
 const conflict=await query('select public.creator_works($1,$2,null,$3,$4) result',[admin,'create',json({title:'새 작품',contentType:'NOVEL'}),key]);assert.equal(conflict.error,'IDEMPOTENCY_CONFLICT');
 assert.equal((await query('select public.creator_works($1,$2,$3,$4) result',[admin,'update',w,json({version:'1',contentType:'NOVEL'})])).error,'INVALID_FIELD');
 const novel=await query('select public.creator_works($1,$2,null,$3,$4) result',[admin,'create',json({title:'소설'}),uid()]);assert.equal(novel.work.content_type,'NOVEL');
});
test('upload identity, owner and cancel-before-prepare tombstone survive late responses',async()=>{
 const w=await work(),id=uid();await asset(w,'prepare',id,metadata);
 assert.equal((await asset(w,'prepare',id,{...metadata,sha:'c'.repeat(64)})).error,'REQUEST_CONFLICT');
 assert.equal((await asset(w,'get',id,{},reader)).error,'WORK_NOT_FOUND');
 await asset(w,'uploaded',id);const claim=await asset(w,'claim',id);assert.equal((await asset(w,'claim',id)).error,'PROCESSING_BUSY');
 await asset(w,'cancel',id);assert.equal((await asset(w,'part',id,{lease:claim.lease,part:0,width:800,height:4096,webpSha:sha,pngSha:sha})).error,'ASSET_CANCELLED');
 const early=uid();await asset(w,'cancel',early);assert.equal((await asset(w,'prepare',early,metadata)).error,'ASSET_CANCELLED');
 assert.equal((await db.query('select count(*) n from authoring.webtoon_assets where id=$1',[id])).rows[0].n,1);
});
test('leases resume after failed panel, stale worker cannot commit and READY rows retain original metadata',async()=>{
 const w=await work(),id=uid();await asset(w,'prepare',id,metadata);await asset(w,'uploaded',id);
 const first=await asset(w,'claim',id);await asset(w,'fail',id,{lease:first.lease});const second=await asset(w,'claim',id);
 assert.equal((await asset(w,'part',id,{lease:first.lease})).error,'PROCESSING_STALE');
 assert.equal((await asset(w,'part',id,{lease:second.lease,part:0,width:800,height:4096,webpSha:sha,pngSha:sha})).asset.cursor,1);
 const third=await asset(w,'claim',id);assert.equal(third.asset.cursor,1);await asset(w,'part',id,{lease:third.lease,part:1,width:800,height:904,webpSha:sha,pngSha:sha});
 assert.equal((await asset(w,'cancel',id)).error,'ASSET_READY');
 await assert.rejects(db.query('delete from authoring.webtoon_panels where asset_id=$1',[id]),/immutable/);
});
test('manifest validates same-work READY assets, order, thumbnail, counts and immutable CAS receipts',async()=>{
 const w=await work(),a=await ready(w),b=await ready(await work()),d=uid(),key=uid();
 assert.equal((await save(w,d,manifest([b.id]))).error,'INVALID_WEBTOON_MANIFEST');
 assert.equal((await save(w,d,manifest([a.id,a.id]))).error,'INVALID_WEBTOON_MANIFEST');
 assert.equal((await save(w,d,{...manifest([a.id]),thumbnailAssetId:b.id})).error,'INVALID_WEBTOON_MANIFEST');
 const m=manifest([a.id]);assert.equal((await save(w,d,m,'0',key)).draft.revision,'1');assert.equal((await save(w,d,m,'0',key)).draft.revision,'1');
 assert.equal((await save(w,d,manifest([]),'0',key)).error,'REQUEST_CONFLICT');assert.equal((await save(w,d,m,'0')).error,'DRAFT_CONFLICT');
 const rev=await save(w,d,manifest([]),'1');assert.equal(rev.draft.revision,'2');
 assert.equal((await db.query('select webtoon from authoring.draft_revisions where draft_id=$1 and revision=1',[d])).rows[0].webtoon.assetIds[0],a.id);
 assert.equal((await asset(w,'cancel',a.id)).error,'ASSET_REFERENCED');
 assert.equal((await publish(w,d,{revision:'2'})).error,'EMPTY_MANUSCRIPT');
});
test('publication freezes manifest, reader metadata excludes storage paths and withdrawal immediately denies image lookup',async()=>{
 const {w,a,d,p}=await published();const version=p.versionId;
 const content=await query('select public.stage18_episode_content($1) result',[p.episodeId]);assert.equal(content.episode.webtoon.panels.length,2);assert.equal(content.episode.content,'');
 const panel=content.episode.webtoon.panels[0].id;
 const image=()=>query('select public.stage18_image($1,$2,$3,$4) result',[p.episodeId,version,panel,'webp']);
 assert.equal((await image()).bucket,'authoring-webtoons');assert.ok(!json(content).includes('webp_sha'));
 const legacy=await query('select public.stage16_episode_content($1) result',[p.episodeId]);assert.equal(legacy.error,'EPISODE_NOT_FOUND');
 const base=await query('select public.creator_publications($1,$2,$3,$4,$5) result',[admin,'begin-edit',w,uid(),p.episodeId]);assert.equal(base.error,'WEBTOON_NOT_ACTIVATED');
 const edit=uid();const opened=await query('select public.creator_publications_v18($1,$2,$3,$4,$5,$6,$7) result',[admin,'begin-edit',w,edit,p.episodeId,'{}',uid()]);assert.deepEqual(opened.draft.webtoon.assetIds,[a.id]);
 await save(w,edit,{...manifest([a.id]),credits:{writer:'수정',artist:'그림'}},'1');const second=await publish(w,edit,{revision:'2'});assert.ok(second.publication);assert.equal((await image()).error,'PANEL_NOT_FOUND');
 assert.equal((await db.query('select webtoon from authoring.publication_versions where id=$1',[version])).rows[0].webtoon.credits.writer,'글');
 await db.query("update authoring.work_state set visibility='PRIVATE' where work_id=$1",[w]);await db.query("update works set status='DRAFT' where id=$1",[w]);
 assert.equal((await query('select public.stage18_episode_content($1) result',[p.episodeId])).error,'EPISODE_NOT_FOUND');
 assert.ok((await asset(w,'read-original',a.id)).path.endsWith('/source'));
});
test('scheduled webtoon keeps exact snapshot, flag-off cron skips it and flag-on cron publishes it',async()=>{
 const w=await work(),a=await ready(w),d=uid();await save(w,d,manifest([a.id]));const p=await publish(w,d,{mode:'SCHEDULED'});assert.ok(p.publication,JSON.stringify(p));
 await db.query("update authoring.schedules set due_at=now()-interval '1 second' where episode_id=$1",[p.publication.episodeId]);
 await query('select public.run_creator_schedules(20) result');assert.equal((await db.query('select status from authoring.schedules where episode_id=$1',[p.publication.episodeId])).rows[0].status,'PENDING');
 await query('select public.run_creator_schedules_v18(20) result');assert.equal((await db.query('select status from authoring.schedules where episode_id=$1',[p.publication.episodeId])).rows[0].status,'SUCCEEDED');
 assert.equal((await query('select public.stage18_episode_content($1) result',[p.publication.episodeId])).episode.webtoon.panels.length,2);
});
test('reader panel positions bind exact head and index, age/paid/moderated images are denied',async()=>{
 const {w,p}=await published();const content=await query('select public.stage18_episode_content($1) result',[p.episodeId]);const pos={versionId:p.versionId,panelIndex:1,offset:0.4};
 const progress=position=>query('select public.stage18_reader($1,$2,$3) result',[reader,'progress',json({workId:w,episodeId:p.episodeId,progress:60,position})]);
 assert.equal((await progress(pos)).positionSaved,true);assert.equal((await progress({...pos,panelIndex:2})).error,'INVALID_POSITION');assert.equal((await progress({...pos,versionId:uid()})).error,'POSITION_VERSION_CHANGED');
 assert.equal((await progress({versionId:p.versionId,paragraphIndex:0,offset:0})).error,'INVALID_POSITION');
 const history=await query('select public.stage18_reader($1,$2) result',[reader,'activity']);assert.deepEqual(history.readingHistory.find(h=>h.workId===w).position,pos);
 const img=()=>query('select public.stage18_image($1,$2,$3,$4) result',[p.episodeId,p.versionId,content.episode.webtoon.panels[0].id,'png']);
 await db.query("update episodes set access_policy='PAID',is_free=false where id=$1",[p.episodeId]);assert.equal((await img()).error,'PANEL_NOT_FOUND');
 await db.query("update episodes set access_policy='FREE',is_free=true where id=$1",[p.episodeId]);await db.query("update works set rating='AGE_19' where id=$1",[w]);assert.equal((await img()).error,'PANEL_NOT_FOUND');
});

test('text writer compatibility preserves webtoon references and cannot inject text into an image manuscript',async()=>{
 const w=await work(),a=await ready(w),d=uid();await save(w,d,manifest([a.id]));
 await assert.rejects(query('select authoring.save_draft($1,1,$2,$3,$4) result',[d,'제목','본문','후기']),/WEBTOON_IMAGE_EDITOR_REQUIRED/);
 assert.equal(await query('select authoring.save_draft($1,1,$2,$3,$4) result',[d,'수정 제목','','후기']),2);
 const current=await query('select public.creator_drafts($1,$2,$3,$4) result',[admin,'get',w,d]);assert.deepEqual(current.draft.webtoon.assetIds,[a.id]);
});

test('legacy enum work type columns accept the same creation API without changing existing IDs',async()=>{
 await db.exec("create type public.stage18_test_type as enum('NOVEL','WEBTOON'); alter table public.works alter content_type drop default; alter table public.works alter content_type type public.stage18_test_type using content_type::public.stage18_test_type; alter table public.works alter content_type set default 'NOVEL'");
 const w=await work();assert.equal((await query('select public.creator_works($1,$2,$3) result',[admin,'get',w])).work.content_type,'WEBTOON');
});
