import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader,limited} from './fixtures/stage17-db.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const uid=()=>crypto.randomUUID(),j=JSON.stringify;
const call=async(db,fn,args=[])=>(await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const works=(db,action,data={},key=null,user=admin,id=null)=>call(db,'creator_works',[user,action,id,j(data),key]);
async function foundation(db){
 await db.exec("set webnovels.workspace_backup_sha256='"+'a'.repeat(64)+"'");
 await db.exec(await read('database/launch/011_new_serial_foundation.sql'));
}
async function publicScope(db){
 await db.exec('alter table authors add column if not exists username text,add column if not exists profile_image text,add column if not exists bio text');
 for(const name of ['011_reader_profile_cutover','015_webtoon','021_manuscript_documents','022_publication_change_review'])
  await db.exec(await read('database/authoring/'+name+'.sql'));
 await db.exec(await read('database/launch/012_new_serial_publication_scope.sql'));
}
async function readyWork(db,type='NOVEL'){
 const r=await works(db,'create',{title:'새 연재',contentType:type},uid());assert.ok(r.work,j(r));
 await db.query("update works set description='소개',genre=array['판타지'] where id=$1",[r.work.id]);
 await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[r.work.id]);return r.work.id;
}
async function publish(db,w,{mode='NOW',number=1}={}){
 const id=uid();
 const d=await call(db,'creator_drafts',[admin,'save',w,id,j({expectedRevision:'0',title:number+'화',content:'새로운 공개 원고',authorComment:''}),uid()]);assert.ok(d.draft,j(d));
  const data={revision:'1',episodeNumber:number,mode,rightsConfirmed:true,...(mode==='SCHEDULED'?{dueAt:new Date(Date.now()+86400000).toISOString(),displayTimezone:'Asia/Seoul'}: {})};
 return call(db,'creator_publications_v18',[admin,'publish',w,id,null,j(data),uid()]);
}

test('005-compatible registration accepts both types for one author, with ownership and type-sensitive retries',async()=>{
 const {db}=await setup();try{
  const source=await read('database/launch/010_multiformat_registration.sql');
  const original=(await db.query('select to_jsonb(w) row from works w order by id')).rows;
  await db.exec(source);await foundation(db);
  await db.exec('set role service_role');assert.equal(await call(db,'launch_work_registration_ready'),true);
  const key=uid(),data={title:'같은 제목',contentType:'WEBTOON'};
  const toon=await works(db,'create',data,key),novel=await works(db,'create',{...data,contentType:'NOVEL'},uid());
  assert.equal(toon.work.content_type,'WEBTOON');assert.equal(novel.work.content_type,'NOVEL');
  assert.notEqual(toon.work.id,novel.work.id);
  assert.equal((await works(db,'create',data,key)).work.id,toon.work.id);
  assert.equal((await works(db,'create',{...data,contentType:'NOVEL'},key)).error,'IDEMPOTENCY_CONFLICT');
  assert.equal((await works(db,'get',{},null,reader,toon.work.id)).status,404);
  assert.equal((await works(db,'create',data,uid(),limited)).status,403);
  assert.equal((await works(db,'update',{version:'1',title:'변경'},null,admin,'10')).error,'PUBLICATION_REVIEW_NOT_ACTIVATED');
  await db.exec('reset role');
  await db.query("update authors set status='SUSPENDED' where auth_user_id=$1",[admin]);
  assert.equal((await works(db,'create',data,uid())).status,403);await db.query("update authors set status='APPROVED' where auth_user_id=$1",[admin]);
  await db.exec(source);await foundation(db);
  assert.deepEqual((await db.query('select to_jsonb(w) row from works w where id in(10,20) order by id')).rows,original);
  assert.equal((await db.query('select count(*)::int n from authoring.new_serial_works')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from authoring.legacy_work_scope')).rows[0].n,2);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);await assert.rejects(db.query('select * from authoring.new_serial_works'),e=>e.code==='42501');
   await assert.rejects(db.query('select * from secure_episode_contents'),e=>e.code==='42501');await db.exec('reset role');
  }
 }finally{await db.close();}
});

test('new serial scope excludes every legacy path, permits immediate and scheduled publication and retains review',async()=>{
 const {db}=await setup();try{
  // The live legacy comments table stores its old user IDs as text; do not rewrite them.
  await db.exec('alter table comments drop constraint comments_user_id_fkey;alter table comments alter column user_id type text using user_id::text');
  // A real old receipt must not be enrolled by a retry after foundation.
  const key=uid(),old=await works(db,'create',{title:'이전 비공개 작품'},key);
  const original=(await db.query('select to_jsonb(e) row from episodes e order by id')).rows;
  await foundation(db);await publicScope(db);
  assert.equal((await works(db,'create',{title:'이전 비공개 작품'},key)).work.id,old.work.id);
  assert.equal((await db.query('select count(*)::int n from authoring.new_serial_works')).rows[0].n,0);
  assert.equal(await call(db,'new_serials_ready'),false);
  const w=await readyWork(db);await assert.rejects(publish(db,w),/NEW_SERIAL_PUBLICATION_REQUIRED/);
  await db.exec('update authoring.new_serial_service set enabled=true');assert.equal(await call(db,'new_serials_ready'),true);
  await assert.rejects(publish(db,'10',{number:4}),/NEW_SERIAL_PUBLICATION_REQUIRED/);
  const first=await publish(db,w);assert.ok(first.publication,j(first));
  assert.equal((await call(db,'stage18_episode_content',[first.publication.episodeId])).episode.content,'새로운 공개 원고');
  const commentData={workId:w,episodeId:first.publication.episodeId};
  assert.ok((await call(db,'stage8_reader',[reader,'comment',j({...commentData,content:'독자 댓글'})])).commentId);
  assert.equal((await call(db,'stage8_reader',[reader,'comments',j(commentData)])).comments[0].mine,true);
  assert.equal((await call(db,'stage18_episode_content',['100'])).status,404);
  assert.equal(await call(db,'new_serial_metadata_visible',['10']),false);
  assert.equal(await call(db,'new_serial_metadata_visible',[w,first.publication.episodeId]),true);
  const pending=await works(db,'update',{version:(await works(db,'get',{},null,admin,w)).work.version,title:'검토 요청'},null,admin,w);
  assert.equal(pending.reviewRequired,true,j(pending));assert.equal((await works(db,'get',{},null,admin,w)).work.title,'새 연재');
  const scheduled=await publish(db,w,{mode:'SCHEDULED',number:2});assert.ok(scheduled.publication,j(scheduled));
  await db.query("update authoring.schedules set due_at=now()-interval '1 minute' where episode_id=$1",[scheduled.publication.episodeId]);
  assert.equal((await call(db,'run_creator_schedules_v18',[20])).published,1);
  // Rollback hides public access immediately while preserving all newly created material.
  await db.exec('update authoring.new_serial_service set enabled=false');assert.equal(await call(db,'new_serial_metadata_visible',[w]),false);
  await db.exec('update authoring.new_serial_service set enabled=true');
  await db.exec(await read('database/launch/012_new_serial_publication_scope.sql'));
  assert.deepEqual((await db.query('select to_jsonb(e) row from episodes e where id in(100,101,200) order by id')).rows,original);
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   assert.deepEqual((await db.query('select id::text from works order by id')).rows,[{id:w}]);
   assert.equal((await db.query('select id from episodes')).rows.length,2);
   await assert.rejects(db.query('select content from episodes'),e=>e.code==='42501');
   await assert.rejects(db.query('select auth_user_id from authors'),e=>e.code==='42501');
   await assert.rejects(db.query('update works set title=\'hijack\''),e=>e.code==='42501');
   await db.exec('reset role');
  }
  await db.exec('set role service_role');await assert.rejects(db.query('select content from secure_episode_contents'),e=>e.code==='42501');await db.exec('reset role');
  await db.exec('grant select on secure_episode_contents to service_role');assert.equal(await call(db,'new_serials_ready'),false);
 }finally{await db.close();}
});

test('legacy webtoon heads, covers, schedules and direct-created works cannot enter new public discovery',async()=>{
 const {db}=await setup();try{
  await db.exec(await read('database/authoring/015_webtoon.sql'));
  async function toon(){
   const w=await readyWork(db,'WEBTOON'),id=uid(),draft=uid();
   const asset=(action,data={})=>call(db,'creator_webtoon',[admin,action,w,id,j(data)]);
   await asset('prepare',{name:'원본.png',sha:'a'.repeat(64),bytes:1000,mime:'image/png',width:800,height:1000});await asset('uploaded');
   const claim=await asset('claim'),a=(await asset('part',{lease:claim.lease,part:0,width:800,height:1000,webpSha:'b'.repeat(64),pngSha:'c'.repeat(64)})).asset;
   const webtoon={schemaVersion:1,assetIds:[id],thumbnailAssetId:id,credits:{artist:'그림'}};
   await call(db,'creator_drafts',[admin,'save',w,draft,j({expectedRevision:'0',title:'첫 화',content:'',authorComment:'',webtoon}),uid()]);
   const p=(await call(db,'creator_publications_v18',[admin,'publish',w,draft,null,j({revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true}),uid()])).publication;
   assert.ok(p);return {w,p,panel:a.panels[0].id};
  }
  async function cover(w){const id=uid();await db.query("insert into authoring.files(id,work_id,author_id,bucket_id,object_key,purpose,sha256,byte_size) values($1::uuid,$2,1,'authoring-covers',$1::uuid::text,'COVER_DERIVATIVE',repeat('a',64),100)",[id,w]);await db.query('update authoring.work_state set cover_file_id=$1 where work_id=$2',[id,w]);return id;}
  const old=await toon(),oldCover=await cover(old.w),oldNovel=await readyWork(db),oldScheduled=await publish(db,oldNovel,{mode:'SCHEDULED'});
  await db.query("update authoring.schedules set due_at=now()-interval '1 minute' where episode_id=$1",[oldScheduled.publication.episodeId]);
  const oldSchedules=(await db.query('select to_jsonb(s) row from authoring.schedules s')).rows;
  await foundation(db);await publicScope(db);await db.exec('update authoring.new_serial_service set enabled=true');
  const fresh=await toon(),newCover=await cover(fresh.w);
  assert.equal((await call(db,'stage18_image',[old.p.episodeId,old.p.versionId,old.panel,'png'])).status,404);
  assert.equal((await call(db,'stage18_image',[fresh.p.episodeId,fresh.p.versionId,fresh.panel,'png'])).bucket,'authoring-webtoons');
  assert.equal((await call(db,'creator_files',[null,'public-cover',null,oldCover])).status,404);
  assert.equal((await call(db,'creator_files',[null,'public-cover',null,newCover])).bucket,'authoring-covers');
  assert.deepEqual((await call(db,'stage18_catalog',['list',j({type:'WEBTOON'})])).works.map(w=>w.id),[fresh.w]);
  assert.deepEqual((await db.query('select work_id::text from authoring.stage18_work_rows(now())')).rows,[{work_id:fresh.w}]); // Shared SEO/sitemap source.
  await call(db,'run_creator_schedules_v18',[20]);await call(db,'run_creator_schedules',[20]);
  assert.deepEqual((await db.query('select to_jsonb(s) row from authoring.schedules s')).rows,oldSchedules);
  const direct=(await db.query("insert into works(author_id,status,rating,title,content_type) values(1,'PUBLISHED','ALL','Direct admin row','NOVEL') returning id")).rows[0].id;
  await db.query("insert into authoring.work_state(work_id,author_id,visibility) values($1,1,'PUBLIC')",[direct]);
  assert.equal(await call(db,'new_serial_metadata_visible',[direct]),false);
  await db.exec('set role anon');assert.deepEqual((await db.query('select id::text from works')).rows,[{id:fresh.w}]);await db.exec('reset role');
  await assert.rejects(db.query('update authoring.new_serial_works set work_id=$1 where work_id=$2',[old.w,fresh.w]),/immutable/);
 }finally{await db.close();}
});
