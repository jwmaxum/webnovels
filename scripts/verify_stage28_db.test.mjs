import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {setup} from './fixtures/stage28-authoring.mjs';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const draft='dddddddd-dddd-4ddd-8ddd-dddddddddddd',key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',next='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload={kind:'IMPORT',filename:'원고.hwpx',sha256:'a'.repeat(64),size:10,draftId:draft,title:'원본',content:'복구 원고 😀',order:0,batchId:key};
async function imported(s){const p=await s.call('prepare',{data:payload});await s.call('commit');return p.original.id;}
async function data(s,fileId,episodeId='100'){const o=await s.recovery('options');return {expectedRevision:o.draft.revision,episodeId,fileId,targetDigest:o.episodes.find(e=>e.id===episodeId).targetDigest,note:'원본 및 수정 내용 확인',confirmed:true};}
async function saved(s,revision='1'){return (await s.db.query('select public.creator_drafts($1,$2,$3,$4,$5,$6,0) result',[uid,'save','10',draft,JSON.stringify({expectedRevision:revision,title:'수정',content:'수정본',authorComment:''}),next])).rows[0].result;}
async function preserved(s){return (await s.db.query(`select jsonb_build_object('episodes',(select jsonb_agg(to_jsonb(x) order by id) from episodes x),
 'drafts',(select jsonb_agg(to_jsonb(x) order by id) from authoring.drafts x),'revisions',(select jsonb_agg(to_jsonb(x) order by revision) from authoring.draft_revisions x),
 'files',(select jsonb_agg(to_jsonb(x) order by id) from authoring.files x),'heads',(select jsonb_agg(to_jsonb(x)) from authoring.publication_heads x)) value`)).rows[0].value;}
test('request freezes evidence privately, exact retry remains immutable after later edits and never binds/publishes a draft',async()=>{
 const s=await setup();try{const file=await imported(s),body=await data(s,file),before=await preserved(s),r=await s.recovery('submit',{data:body});
 assert.equal(r.request.status,'PENDING');assert.equal(r.request.revision,'1');assert.equal(r.request.sourceRevision,'1');assert.equal(r.request.fileSha256,'a'.repeat(64));assert.deepEqual(await preserved(s),before);
 assert.deepEqual(await s.recovery('submit',{data:body}),r);assert.equal((await s.recovery('submit',{data:{...body,note:'different'}})).error,'REQUEST_CONFLICT');
 await saved(s);await s.db.exec("update episodes set content='changed' where id=100; update authoring.drafts set lifecycle='TRASHED',trashed_at=now(); update authoring.work_state set trashed_at=now() where work_id=10");
 assert.deepEqual(await s.recovery('submit',{data:body}),r);assert.equal((await s.db.query('select count(*)::int n from authoring.recovery_requests')).rows[0].n,1);
 assert.equal((await s.db.query('select target_snapshot#>>\'{episode,content}\' content from authoring.recovery_requests')).rows[0].content,'Original body');
 await assert.rejects(s.db.exec("update authoring.recovery_requests set status='PENDING'"),/Immutable/);await assert.rejects(s.db.exec('delete from authoring.recovery_requests'),/Immutable/);
 }finally{await s.db.close();}
});
test('edited imported drafts retain historical original lineage; stale revision and changed episode/protected/alternate snapshots reject atomically',async()=>{
 const s=await setup();try{const file=await imported(s);await saved(s);const options=await s.recovery('options');assert.equal(options.files[0].sourceRevision,'1');assert.equal(options.draft.revision,'2');
 let body=await data(s,file);assert.equal((await s.recovery('submit',{data:{...body,expectedRevision:'1'}})).error,'DRAFT_REVISION_CONFLICT');
 await s.db.exec("update episodes set title='changed' where id=100");assert.equal((await s.recovery('submit',{data:body})).error,'RECOVERY_TARGET_CONFLICT');
 body=await data(s,file);await s.db.exec("update secure_episode_contents set content='protected changed' where episode_id=100");assert.equal((await s.recovery('submit',{data:body})).error,'RECOVERY_TARGET_CONFLICT');
 await s.db.exec("create table episode_contents(episode_id bigint,text_content text);insert into episode_contents values(100,'alternate')");body=await data(s,file);await s.db.exec("update episode_contents set text_content='new alternate'");assert.equal((await s.recovery('submit',{data:body})).error,'RECOVERY_TARGET_CONFLICT');
 body=await data(s,file);const before=await preserved(s),r=await s.recovery('submit',{data:body});assert.equal(r.request.revision,'2');assert.equal(r.request.sourceRevision,'1');assert.deepEqual(await preserved(s),before);
 const o=await s.recovery('options');assert.equal(o.requests.length,1);assert.ok(!JSON.stringify(o).includes('object_key'));assert.ok(!JSON.stringify(o).includes('alternate'));assert.ok(!JSON.stringify(o).includes('protected changed'));
 }finally{await s.db.close();}
});
test('ownership domains and original file commit/lineage are required; failures preserve all stored data',async()=>{
 const s=await setup();try{const p=await s.call('prepare',{data:payload});assert.equal((await s.recovery('options')).status,404);await s.call('commit');const file=p.original.id,body=await data(s,file),before=await preserved(s);
 for(const args of [{user:other},{work:'20'},{id:next},{data:{...body,episodeId:'200'}},{data:{...body,fileId:next}}])assert.equal((await s.recovery('submit',{data:body,...args})).status,404);
 await s.db.exec("update authoring.file_jobs set state='PREPARED'");assert.equal((await s.recovery('submit',{data:body})).error,'SOURCE_FILE_NOT_FOUND');await s.db.exec("update authoring.file_jobs set state='COMMITTED'");
 await s.db.exec('delete from authoring.revision_files');assert.equal((await s.recovery('submit',{data:body})).error,'SOURCE_FILE_NOT_FOUND');
 assert.deepEqual(await preserved(s),before);assert.equal((await s.db.query('select count(*)::int n from authoring.recovery_requests')).rows[0].n,0);
 }finally{await s.db.close();}
});
test('account/work/type/lifecycle gates and direct malformed RPC input cannot bypass pending-only review',async()=>{
 const s=await setup();try{const file=await imported(s),body=await data(s,file);
 for(const [change,undo,error]of [
 ["update auth.users set banned_until=now()+interval '1 day' where id='"+uid+"'","update auth.users set banned_until=null",'ACCOUNT_INACTIVE'],
 ["update authors set status='SUSPENDED' where id=1","update authors set status='APPROVED' where id=1",'AUTHOR_REQUIRED'],
 ["update works set content_type='WEBTOON' where id=10","update works set content_type='NOVEL' where id=10",'RECOVERY_NOVEL_REQUIRED'],
 ["update authoring.work_state set moderation_state='RESTRICTED',moderation_reason='review' where work_id=10","update authoring.work_state set moderation_state='CLEAR',moderation_reason=null where work_id=10",'RECOVERY_READ_ONLY'],
 ["update authoring.drafts set episode_id=100","update authoring.drafts set episode_id=null",'RECOVERY_READ_ONLY']]){await s.db.exec(change);assert.equal((await s.recovery('submit',{data:body})).error,error);await s.db.exec(undo);}
 for(const invalid of [{...body,confirmed:false},{...body,expectedRevision:1},{...body,episodeId:'9223372036854775808'},{...body,fileSha256:'b'.repeat(64)},{...body,fileId:'1'},{...body,note:'x'.repeat(2001)}])assert.equal((await s.recovery('submit',{data:invalid})).status,400);
 assert.equal((await s.recovery('submit',{data:body,requestKey:null})).status,400);assert.equal((await s.recovery('unknown')).status,404);
 }finally{await s.db.close();}
});
test('private table is inaccessible even to service_role; only service-only RPC and reviewed additive migration are usable',async()=>{
 const s=await setup();try{await imported(s);for(const role of ['anon','authenticated','service_role']){await s.db.exec('set role '+role);await assert.rejects(s.db.exec('select * from authoring.recovery_requests'));
 if(role!=='service_role')await assert.rejects(s.recovery('options'));else assert.equal((await s.recovery('options')).draft.id,draft);await s.db.exec('reset role');}
 const sql=await readFile('database/authoring/019_creator_recovery_requests.sql','utf8');await s.db.exec(sql);await s.db.exec("set webnovels.authoring_apply_verified='false'");await assert.rejects(s.db.exec(sql),/prerequisite/);await s.db.exec('rollback');
 }finally{await s.db.close();}
});
test('episode choices paginate without silently dropping targets and preserve bigint IDs',async()=>{
 const s=await setup();try{await imported(s);await s.db.exec("insert into episodes(id,work_id,episode_number,title,content,image_urls,status) select 1000+n,10,10+n,'회차','본문','[]','DRAFT' from generate_series(1,101) n");const first=await s.recovery('options');assert.equal(first.episodes.length,100);assert.ok(first.nextCursor);const second=await s.recovery('options',{after:first.nextCursor});assert.equal(second.episodes.length,3);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.episodes,...second.episodes].map(e=>e.id)).size,103);
 assert.equal((await s.recovery('options',{after:'-1'})).status,400);
 await s.db.exec("insert into episodes(id,work_id,episode_number,title,content,image_urls,status) values(9007199254740993,10,200,'큰 ID','본문','[]','DRAFT')");
 const large=await s.recovery('options',{after:'9007199254740992'});assert.equal(large.episodes[0].id,'9007199254740993');
 const r=await s.recovery('submit',{data:{expectedRevision:'1',episodeId:large.episodes[0].id,fileId:first.files[0].id,targetDigest:large.episodes[0].targetDigest,note:'',confirmed:true}});assert.equal(r.request.episodeId,'9007199254740993');
 }finally{await s.db.close();}
});
