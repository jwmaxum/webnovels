import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8'),uid=()=>crypto.randomUUID();
const migration=await read('database/authoring/031_creator_draft_list_summary.sql');let db,baseline;
const rpc=async(action,{work=20,id=null,user=reader,data={},key=uid()}={})=>(await db.query('select public.creator_drafts($1,$2,$3,$4,$5,$6,0) result',[user,action,work,id,JSON.stringify(data),key])).rows[0].result;
const save=(id,{revision='0',title='draft',content='private content'}={})=>rpc('save',{id,data:{expectedRevision:revision,title,content,authorComment:''}});

before(async()=>{
  ({db}=await setup());
  for(const version of ['015_webtoon','021_manuscript_documents','022_publication_change_review','028_publication_history_contract'])await db.exec(await read('database/authoring/'+version+'.sql'));
  const first=uid(),second=uid();await save(first,{title:'created first'});await save(second,{title:'created second'});
  await save(first,{revision:'1',title:'first draft edited last'});
  baseline={first,second,rows:(await db.query('select * from authoring.drafts order by id')).rows,
    revisions:(await db.query('select * from authoring.draft_revisions order by draft_id,revision')).rows,
    receipts:(await db.query('select * from authoring.draft_save_requests order by request_key')).rows,
    definition:(await db.query("select pg_get_functiondef('public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint)'::regprocedure) definition")).rows[0].definition};
  await db.exec(migration);
});
after(async()=>db?.close());

test('latest server list means last authored revision, with summary-only fields and preserved manuscripts',async()=>{
  const list=await rpc('list');assert.equal(list.drafts[0].id,baseline.first);assert.equal(list.drafts[0].title,'first draft edited last');
  for(const row of list.drafts){assert.ok(row.createdAt);assert.ok(row.updatedAt);assert.equal(typeof row.revision,'string');assert.equal('content' in row,false);assert.equal('authorComment' in row,false);}
  assert.deepEqual((await db.query('select * from authoring.drafts order by id')).rows,baseline.rows);
  assert.deepEqual((await db.query('select * from authoring.draft_revisions order by draft_id,revision')).rows,baseline.revisions);
  assert.deepEqual((await db.query('select * from authoring.draft_save_requests order by request_key')).rows,baseline.receipts);
  const expected=(await db.query('select created_at from authoring.draft_revisions where draft_id=$1 and revision=2',[baseline.first])).rows[0].created_at;
  assert.equal(new Date(list.drafts[0].updatedAt).toISOString(),new Date(expected).toISOString());
});

test('lifecycle timestamp changes cannot masquerade as authored edits; all archive summaries remain available',async()=>{
  await db.query("update authoring.drafts set lifecycle='PUBLISHED',updated_at=now()+interval '1 day' where id=$1",[baseline.second]);
  const list=(await rpc('list')).drafts;assert.equal(list[0].id,baseline.first);assert.equal(list.find(row=>row.id===baseline.second).lifecycle,'PUBLISHED');
  assert.equal(list.length,2,'no original or archive is deleted or filtered by SQL');
});

test('actual roles retain owner-only service RPC and deny browser/direct-table reads',async()=>{
  await db.exec('revoke all on all tables in schema public from anon,authenticated,service_role; revoke all on all sequences in schema public from anon,authenticated,service_role');
  await db.exec('revoke all on authoring.drafts from service_role');
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);
    try{
      await assert.rejects(db.query('select * from authoring.drafts'),error=>error.code==='42501');
      if(role==='service_role'){
        assert.equal((await rpc('list')).drafts.length,2);assert.equal((await rpc('list',{user:admin})).error,'WORK_NOT_FOUND');
        assert.equal((await rpc('get',{id:baseline.first})).draft.content,'private content');
      }else await assert.rejects(rpc('list'),error=>error.code==='42501');
    }finally{await db.exec('reset role');}
  }
});

test('replay changes no data and guard rejects unreviewed/unknown function bodies atomically',async()=>{
  await db.exec(migration);assert.equal((await rpc('list')).drafts[0].id,baseline.first);
  assert.equal((await db.query("select count(*)::int n from authoring.migrations where version='authoring-031'")).rows[0].n,1);
  await db.exec("set webnovels.authoring_apply_verified='false'");await assert.rejects(db.exec(migration),/Reviewed authoring-021/);await db.exec('rollback');
  await db.exec("set webnovels.authoring_apply_verified='true'");
  const definition=(await db.query("select pg_get_functiondef('public.creator_drafts(uuid,text,bigint,uuid,jsonb,uuid,bigint)'::regprocedure) definition")).rows[0].definition;
  await db.exec(definition.replace("'updatedAt',r.created_at","'updatedAt',dd.updated_at"));
  await assert.rejects(db.exec(migration),/Unexpected draft list definition/);await db.exec('rollback');await db.exec(definition);
  assert.equal((await rpc('get',{id:baseline.first})).draft.revision,'2');
});
