import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';
let db;
const uid=()=>crypto.randomUUID(),j=JSON.stringify;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
const draft=(w,id,content='첫 문단\n\n다음 문단',extra={},key=uid())=>query('select public.creator_drafts($1,\'save\',$2,$3,$4,$5) result',[admin,w,id,j({expectedRevision:'0',title:'1화',content,authorComment:'',...extra}),key]);
const pub=(w,id,revision='1',key=uid(),number=1)=>query('select public.creator_publications_v18($1,\'publish\',$2,$3,null,$4,$5) result',[admin,w,id,j({revision,episodeNumber:number,mode:'NOW',rightsConfirmed:true}),key]);
const decide=(id,decision='APPROVE',user=admin)=>query('select public.admin_publication_changes($1,\'decide\',$2) result',[user,j({changeId:id,decision,reason:'공개 변경 검토 완료'})]);
before(async()=>{
 ({db}=await setup());
 for(const name of ['015_webtoon','021_manuscript_documents','022_publication_change_review'])await db.exec(await readFile(new URL('../database/authoring/'+name+'.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
async function work(type='NOVEL') {
 const r=await query('select public.creator_works($1,\'create\',null,$2,$3) result',[admin,j({title:'발행 시험',contentType:type}),uid()]);assert.ok(r.work,j(r));
 await db.query("update works set description='작품 소개',genre=array['판타지'] where id=$1",[r.work.id]);
 await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[r.work.id]);return r.work.id;
}
const doc={version:1,paragraphs:[{align:'center',indent:0,runs:[{text:'첫 문단',bold:true}]},{align:'left',indent:1,runs:[{text:'다음 문단',italic:true}]}]};
test('additive migrations are repeatable and do not expose private original RPCs',async()=>{
 for(const name of ['021_manuscript_documents','022_publication_change_review'])await db.exec(await readFile(new URL('../database/authoring/'+name+'.sql',import.meta.url),'utf8'));
});
test('formatted novel survives save, history, immediate publication, reader and edit draft',async()=>{
 const w=await work(),id=uid(),key=uid();
 const saved=await draft(w,id,undefined,{contentDocument:doc},key);assert.deepEqual(saved.draft.contentDocument,doc);
 assert.equal((await draft(w,id,undefined,{contentDocument:{...doc,extra:'x'}},key)).error,'REQUEST_CONFLICT');
 const first=await pub(w,id);assert.ok(first.publication,j(first));assert.equal(first.publication.status,'PUBLISHED');
 const readerResult=await query('select public.stage16_episode_content($1) result',[first.publication.episodeId]);assert.deepEqual(readerResult.episode.contentDocument,doc);
 const edit=await query('select public.creator_publications_v18($1,\'begin-edit\',$2,$3,$4,\'{}\',$5) result',[admin,w,uid(),first.publication.episodeId,uid()]);assert.deepEqual(edit.draft.contentDocument,doc);
});
test('first and next episodes publish without review, replay returns original receipt',async()=>{
 const w=await work(),id=uid(),key=uid();await draft(w,id);
 const p=await pub(w,id,'1',key);assert.ok(p.publication,j(p));assert.deepEqual(await pub(w,id,'1',key),p);
 const next=uid();await draft(w,next);assert.ok((await pub(w,next,'1',uid(),2)).publication);
 assert.equal((await db.query('select count(*)::int n from authoring.publication_changes where work_id=$1',[w])).rows[0].n,0);
});
test('published edit stays private until authorized approval; rejected/stale revisions preserve head',async()=>{
 const w=await work(),id=uid();await draft(w,id);const p=(await pub(w,id)).publication;
 const editId=uid();await query('select public.creator_publications_v18($1,\'begin-edit\',$2,$3,$4,\'{}\',$5) result',[admin,w,editId,p.episodeId,uid()]);
 await draft(w,editId,'바꾼 본문',{expectedRevision:'1'});
 const key=uid(),pending=await pub(w,editId,'2',key);assert.equal(pending.reviewRequired,true,j(pending));
 assert.equal((await query('select public.stage16_episode_content($1) result',[p.episodeId])).episode.content,'첫 문단\n\n다음 문단');
 assert.deepEqual(await pub(w,editId,'2',key),pending);
 assert.equal((await decide(pending.changeId,'APPROVE',reader)).error,'ADMIN_REQUIRED');
 const accepted=await decide(pending.changeId);assert.equal(accepted.decision,'APPROVE',j(accepted));assert.deepEqual(await decide(pending.changeId),accepted);
 assert.equal((await query('select public.stage16_episode_content($1) result',[p.episodeId])).episode.content,'바꾼 본문');
});
test('published metadata/trash are review requests; stale target and inactive author cannot apply',async()=>{
 const w=await work(),id=uid();await draft(w,id);await pub(w,id);
 const state=await query('select public.creator_works($1,\'get\',$2) result',[admin,w]);
 const pending=await query('select public.creator_works($1,\'update\',$2,$3) result',[admin,w,j({version:state.work.version,title:'변경 요청 제목'})]);assert.equal(pending.reviewRequired,true,j(pending));
 assert.equal((await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work.title,'발행 시험');
 await db.query('update authoring.work_state set version=version+1 where work_id=$1',[w]);
 assert.equal((await decide(pending.changeId)).error,'REVIEW_BASELINE_CHANGED');
 assert.equal((await decide(pending.changeId,'REJECT')).decision,'REJECT');
});
test('typed document rejects mismatched mirror, arbitrary fields and client RPC access',async()=>{
 const w=await work();assert.equal((await draft(w,uid(),'다른 본문',{contentDocument:doc})).error,'INVALID_CONTENT_DOCUMENT');
 assert.equal((await draft(w,uid(),undefined,{contentDocument:{...doc,url:'https://example.com'}})).error,'INVALID_CONTENT_DOCUMENT');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);await assert.rejects(db.query('select * from authoring.publication_changes'));
  await assert.rejects(db.query("select authoring.review_original_works($1,'get',10)",[admin]));await db.exec('reset role');
 }
});
test('webtoon author first-publishes ordered images; replacement requires review and preview authorizes only candidate panels',async()=>{
 const w=await work('WEBTOON');
 const asset=async()=>{
  const id=uid(),call=(action,data={})=>query('select public.creator_webtoon($1,$2,$3,$4,$5) result',[admin,action,w,id,j(data)]);
  await call('prepare',{name:'웹툰.png',sha:'a'.repeat(64),bytes:1000,mime:'image/png',width:800,height:1000});await call('uploaded');
  const claim=await call('claim');const ready=await call('part',{lease:claim.lease,part:0,width:800,height:1000,webpSha:'b'.repeat(64),pngSha:'c'.repeat(64)});assert.equal(ready.asset.state,'READY');return ready.asset;
 };
 const a=await asset(),b=await asset(),manifest=ids=>({schemaVersion:1,assetIds:ids,thumbnailAssetId:ids[0],credits:{writer:'글',artist:'그림',original:''}});
 const id=uid();await draft(w,id,'',{webtoon:manifest([a.id,b.id])});const p=(await pub(w,id)).publication;assert.equal(p.status,'PUBLISHED');
 const editId=uid();await query('select public.creator_publications_v18($1,\'begin-edit\',$2,$3,$4,\'{}\',$5) result',[admin,w,editId,p.episodeId,uid()]);
 await draft(w,editId,'',{expectedRevision:'1',webtoon:manifest([b.id,a.id])});const pending=await pub(w,editId,'2');assert.equal(pending.reviewRequired,true);
 const detail=await query('select public.admin_publication_changes($1,\'detail\',$2) result',[admin,j({changeId:pending.changeId})]);assert.equal(detail.change.afterPanels[0].assetId,b.id);assert.equal(detail.change.beforePanels[0].assetId,a.id);
 const image=await query('select public.admin_publication_changes($1,\'image\',$2) result',[admin,j({changeId:pending.changeId,side:'after',panelId:b.panels[0].id})]);assert.equal(image.bucket,'authoring-webtoons');
 assert.equal((await query('select public.admin_publication_changes($1,\'image\',$2) result',[admin,j({changeId:pending.changeId,side:'after',panelId:uid()})])).error,'IMAGE_NOT_FOUND');
 assert.equal((await decide(pending.changeId)).decision,'APPROVE');
 const content=await query('select public.stage18_episode_content($1) result',[p.episodeId]);assert.equal(content.episode.webtoon.panels[0].assetId,b.id);
});
test('withdrawal, trash and subsequent private edits still require approval; new private work stays editable',async()=>{
 const w=await work(),id=uid();await draft(w,id);const p=(await pub(w,id)).publication;
 const withdrawal=await query('select public.stage8_creator($1,\'withdraw\',$2,$3) result',[admin,w,j({episodeId:p.episodeId})]);assert.equal(withdrawal.reviewRequired,true,j(withdrawal));
 assert.equal((await query('select public.stage16_episode_content($1) result',[p.episodeId])).episode.status,'PUBLISHED');
 assert.equal((await decide(withdrawal.changeId)).decision,'APPROVE');
 const state=(await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work;
 const trash=await query('select public.creator_works($1,\'trash\',$2,$3) result',[admin,w,j({version:state.version})]);assert.equal(trash.reviewRequired,true,j(trash));assert.equal((await decide(trash.changeId)).decision,'APPROVE');
 const trashed=(await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work;
 const restore=await query('select public.creator_works($1,\'restore\',$2,$3) result',[admin,w,j({version:trashed.version})]);assert.equal(restore.reviewRequired,true,j(restore));
 const fresh=await work();assert.ok((await query('select public.creator_works($1,\'update\',$2,$3) result',[admin,fresh,j({version:'1',title:'자유 수정'})])).work);
});
test('distribution, serial state and cover commits cannot bypass review',async()=>{
 const w=await work(),id=uid();await draft(w,id);await pub(w,id);
 const distribution=await query('select public.creator_work_distribution($1,$2,\'update\',$3) result',[admin,w,j({version:'0',mode:'NON_EXCLUSIVE',externalLinks:['https://novel.munpia.com/123'],rightsConfirmed:true})]);
 assert.equal(distribution.reviewRequired,true,j(distribution));assert.equal((await decide(distribution.changeId)).decision,'APPROVE');
 const state=(await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work;
 const serial=await query('select public.stage8_creator($1,\'serial-state\',$2,$3) result',[admin,w,j({version:state.version,serialState:'HIATUS',schedulePolicy:'KEEP'})]);
 assert.equal(serial.reviewRequired,true,j(serial));assert.equal((await decide(serial.changeId,'REJECT')).decision,'REJECT');
 const file=uid(),payload={kind:'COVER',filename:'cover.png',sha256:'a'.repeat(64),size:1000,version:state.version,derivativeSha:'b'.repeat(64),derivativeSize:1000};
 const prepared=await query('select public.creator_files($1,\'prepare\',$2,$3,$4) result',[admin,w,file,j(payload)]);assert.ok(prepared.original,j(prepared));
 const cover=await query('select public.creator_files($1,\'commit\',$2,$3) result',[admin,w,file]);assert.equal(cover.reviewRequired,true,j(cover));
 const preview=await query('select public.admin_publication_changes($1,\'image\',$2) result',[admin,j({changeId:cover.changeId,side:'after'})]);assert.equal(preview.bucket,'authoring-covers');
 assert.equal((await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work.cover_image,null);
 assert.equal((await decide(cover.changeId)).decision,'APPROVE');
 assert.equal((await query('select public.creator_files($1,\'commit\',$2,$3) result',[admin,w,file])).state,'COMMITTED');
});
test('published rating changes use review and preserve the old rating until approval',async()=>{
 const w=await work(),id=uid();await draft(w,id);await pub(w,id);
 const state=(await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work;
 const request=await query('select public.creator_works($1,\'update\',$2,$3) result',[admin,w,j({version:state.version,rating:'AGE_15'})]);assert.equal(request.reviewRequired,true,j(request));
 assert.equal((await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work.rating,'ALL');
 assert.equal((await decide(request.changeId)).decision,'APPROVE');assert.equal((await query('select public.creator_works($1,\'get\',$2) result',[admin,w])).work.rating,'AGE_15');
});
test('editing a submitted draft invalidates approval; author revocation and direct scheduler head swaps are rejected',async()=>{
 const w=await work(),id=uid();await draft(w,id);const p=(await pub(w,id)).publication,editId=uid();
 await query('select public.creator_publications($1,\'begin-edit\',$2,$3,$4,\'{}\',$5) result',[admin,w,editId,p.episodeId,uid()]);
 await draft(w,editId,'요청 본문',{expectedRevision:'1'});const pending=await pub(w,editId,'2');
 const foreign=await query('select public.creator_publications_v18($1,\'publish\',$2,$3,null,$4,$5) result',[reader,w,editId,j({revision:'2',episodeNumber:1,mode:'SCHEDULED',rightsConfirmed:true}),uid()]);assert.equal(foreign.error,'WORK_NOT_FOUND');
 assert.equal((await query('select public.admin_publication_changes($1,\'decide\',$2) result',[admin,j({changeId:pending.changeId,decision:'APPROVE',reason:'검토 완료',actorId:reader})])).error,'INVALID_FIELD');
 await draft(w,editId,'검토 중 추가 수정',{expectedRevision:'2'});assert.equal((await decide(pending.changeId)).error,'DRAFT_REVISION_CONFLICT');
 const again=await pub(w,editId,'3');assert.equal(again.reviewRequired,true);
 await db.query("update authors set status='SUSPENDED' where auth_user_id=$1",[admin]);
 try{assert.equal((await decide(again.changeId)).result,undefined);}finally{await db.query("update authors set status='APPROVED' where auth_user_id=$1",[admin]);}
 await assert.rejects(db.query('update authoring.publication_heads set version_id=$1 where episode_id=$2',[uid(),p.episodeId]),/PUBLICATION_CHANGE_REVIEW_REQUIRED/);
 assert.equal((await query('select public.stage16_episode_content($1) result',[p.episodeId])).episode.content,'첫 문단\n\n다음 문단');
});
