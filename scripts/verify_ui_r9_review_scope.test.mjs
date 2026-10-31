import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader} from './fixtures/stage17-db.mjs';

// Synthetic PostgreSQL only. No env, network, production DB or service activation.
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8'),uid=()=>crypto.randomUUID(),j=JSON.stringify;
const migration=await read('database/authoring/029_publication_change_work_scope.sql'),owner=reader;
let db,legacy,legacyRows,metadata;
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const rpc=async(name,args)=>(await rows(`select public.${name}(${args.map((_value,index)=>'$'+(index+1)).join(',')}) result`,args))[0].result;
const workRpc=(action,work=null,data={})=>rpc('creator_works',[owner,action,work,j(data),action==='create'?uid():null]);
const publish=(work,draft,{key=uid(),revision='1',number=1}={})=>rpc('creator_publications_v18',[owner,'publish',work,draft,null,j({revision,episodeNumber:number,mode:'NOW',rightsConfirmed:true}),key]);
const decide=(changeId,decision='APPROVE',reason='작품 범위 분리 검토 완료')=>rpc('admin_publication_changes',[admin,'decide',j({changeId,decision,reason})]);
const reviewRows=async()=>({changes:await rows('select to_jsonb(c) item from authoring.publication_changes c order by id'),decisions:await rows('select to_jsonb(d) item from authoring.publication_change_decisions d order by change_id')});
const identityMetadata=async()=>({
 functions:await rows("select oid::regprocedure::text signature,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid in ('authoring.review_change(text,uuid,bigint,jsonb,boolean)'::regprocedure,'public.creator_works(uuid,text,bigint,jsonb,uuid,text,bigint)'::regprocedure,'public.admin_publication_changes(uuid,text,jsonb)'::regprocedure) order by signature"),
 tables:await rows("select relname,relowner,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid in ('authoring.publication_changes'::regclass,'authoring.publication_change_decisions'::regclass) order by relname"),
 triggers:await rows("select tgrelid::regclass::text relation,tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid in ('authoring.publication_changes'::regclass,'authoring.publication_change_decisions'::regclass) and not tgisinternal order by relation,tgname")
});
async function publicWork(label){
 const created=await workRpc('create',null,{title:'범위 분리 '+label,contentType:'NOVEL'});assert.ok(created.work,j(created));
 const work=created.work.id;
 await db.query("update public.works set description='시험 소개',genre=array['일상'] where id=$1",[work]);
 await db.query('update authoring.work_state set rating_confirmed=true,ai_confirmed=true where work_id=$1',[work]);
 const draft=uid(),saved=await rpc('creator_drafts',[owner,'save',work,draft,j({expectedRevision:'0',title:'첫 회차',content:'최초 공개 본문',authorComment:''}),uid()]);assert.ok(saved.draft,j(saved));
 const published=await publish(work,draft);assert.equal(published.publication.status,'PUBLISHED',j(published));
 return {work,draft,publication:published.publication,version:(await workRpc('get',work)).work.version};
}
async function edit(work){
 const id=uid(),opened=await rpc('creator_publications_v18',[owner,'begin-edit',work.work,id,work.publication.episodeId,'{}',uid()]);assert.ok(opened.draft,j(opened));
 const saved=await rpc('creator_drafts',[owner,'save',work.work,id,j({expectedRevision:'1',title:'바뀐 회차',content:'승인할 변경 본문',authorComment:''}),uid()]);assert.equal(saved.draft.revision,'2',j(saved));return id;
}

before(async()=>{
 ({db}=await setup());
 for(const name of ['015_webtoon','021_manuscript_documents','022_publication_change_review'])await db.exec(await read('database/authoring/'+name+'.sql'));
 const first=await publicWork('기존 첫 작품'),second=await publicWork('기존 둘째 작품');assert.equal(first.version,second.version);
 const data={visibility:'PRIVATE',version:first.version},request=await workRpc('update',first.work,data);assert.equal(request.reviewRequired,true,j(request));
 assert.deepEqual(await workRpc('update',second.work,data),request,'pre-029 reproduction: identical request returns another work receipt');
 const approved=await decide(request.changeId);assert.equal(approved.decision,'APPROVE',j(approved));
 const rejectedWork=await publicWork('기존 반려 작품'),rejectedData={title:'반려할 제목',version:rejectedWork.version};
 const rejectedRequest=await workRpc('update',rejectedWork.work,rejectedData);assert.equal(rejectedRequest.reviewRequired,true,j(rejectedRequest));
 const rejection=await decide(rejectedRequest.changeId,'REJECT');assert.equal(rejection.decision,'REJECT',j(rejection));
 legacy={first,second,data,request,approved,rejectedWork,rejectedData,rejectedRequest,rejection};legacyRows=await reviewRows();metadata=await identityMetadata();
 await db.exec(migration);
});
after(async()=>db?.close());

test('029 preserves pre-existing immutable receipts, decisions, owner, ACL, RLS and helper settings',async()=>{
 assert.deepEqual(await reviewRows(),legacyRows);assert.deepEqual(await identityMetadata(),metadata);
 const constraints=await rows("select array(select a.attname from unnest(c.conkey) with ordinality x(n,p) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n order by x.p) columns from pg_constraint c where c.conrelid='authoring.publication_changes'::regclass and c.contype='u'");
 assert.deepEqual(constraints,[{columns:['user_id','work_id','kind','request_fingerprint']}]);
 const definition=(await rows("select pg_get_functiondef('authoring.review_change(text,uuid,bigint,jsonb,boolean)'::regprocedure) definition"))[0].definition;
 assert.match(definition,/where user_id=u and work_id=w and kind=k and arguments=args;/);
 assert.match(definition,/where user_id=u and work_id=w and kind=k and arguments->>'key'=args->>'key'/);
});

test('same author, version and PRIVATE payload create distinct work receipts and isolated approvals',async()=>{
 const {first,second,data,request}=legacy,result=await workRpc('update',second.work,data);
 assert.equal(result.reviewRequired,true,j(result));assert.notEqual(result.changeId,request.changeId);assert.deepEqual(await workRpc('update',second.work,data),result);
 const receipts=await rows('select work_id::text,request_fingerprint from authoring.publication_changes where id=any($1::uuid[]) order by work_id',[[request.changeId,result.changeId]]);
 assert.equal(receipts.length,2);assert.equal(receipts[0].request_fingerprint,receipts[1].request_fingerprint,'identical arguments coexist only because work scope is included');
 assert.equal((await workRpc('get',first.work)).work.visibility,'PRIVATE');assert.equal((await workRpc('get',second.work)).work.visibility,'PUBLIC','review itself does not hide the second work');
 const firstBefore=await workRpc('get',first.work),approved=await decide(result.changeId);assert.equal(approved.decision,'APPROVE',j(approved));
 assert.equal((await workRpc('get',second.work)).work.visibility,'PRIVATE');assert.deepEqual(await workRpc('get',first.work),firstBefore);
 assert.deepEqual(await decide(result.changeId),approved,'same decision/reason replay keeps its result');
 assert.deepEqual(await workRpc('update',second.work,data),result,'same request retry survives its approval and changed version');
});

test('an approved pre-029 request still replays its original receipt and decision without reapplying',async()=>{
 const before=await workRpc('get',legacy.first.work),count=(await reviewRows()).changes.length;
 assert.deepEqual(await workRpc('update',legacy.first.work,legacy.data),legacy.request);
 assert.deepEqual(await decide(legacy.request.changeId),legacy.approved);
 assert.deepEqual(await workRpc('update',legacy.rejectedWork.work,legacy.rejectedData),legacy.rejectedRequest);
 assert.deepEqual(await decide(legacy.rejectedRequest.changeId,'REJECT'),legacy.rejection);
 assert.deepEqual(await workRpc('get',legacy.first.work),before);assert.equal((await reviewRows()).changes.length,count);
});

test('publication keys are independent across works while same-work different-argument reuse conflicts',async()=>{
 const a=await publicWork('공개 수정 A'),b=await publicWork('공개 수정 B'),draftA=await edit(a),draftB=await edit(b),key=uid();
 const requestA=await publish(a.work,draftA,{key,revision:'2'}),requestB=await publish(b.work,draftB,{key,revision:'2'});
 assert.equal(requestA.reviewRequired,true,j(requestA));assert.equal(requestB.reviewRequired,true,j(requestB));assert.notEqual(requestA.changeId,requestB.changeId);
 assert.deepEqual(await publish(a.work,draftA,{key,revision:'2'}),requestA);assert.deepEqual(await publish(b.work,draftB,{key,revision:'2'}),requestB);
 assert.equal((await publish(a.work,draftA,{key,revision:'3'})).error,'IDEMPOTENCY_CONFLICT');
 const head=async work=>(await rows('select version_id from authoring.publication_heads where episode_id=$1',[work.publication.episodeId]))[0].version_id;
 assert.equal(await head(a),a.publication.versionId);assert.equal(await head(b),b.publication.versionId);
 assert.equal((await decide(requestA.changeId)).decision,'APPROVE');assert.notEqual(await head(a),a.publication.versionId);assert.equal(await head(b),b.publication.versionId);
 assert.equal((await decide(requestB.changeId)).decision,'APPROVE');assert.notEqual(await head(b),b.publication.versionId);
});

test('actual API roles retain private-table/helper denial and only service wrappers execute',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(db.query('select * from authoring.publication_changes'),error=>error.code==='42501');
   await assert.rejects(db.query('select * from authoring.publication_change_decisions'),error=>error.code==='42501');
   await assert.rejects(db.query('select authoring.review_change($1,$2,$3,$4,true)',['work',owner,legacy.second.work,j({})]),error=>error.code==='42501');
   if(role!=='service_role'){
    await assert.rejects(workRpc('get',legacy.second.work),error=>error.code==='42501');
    await assert.rejects(rpc('admin_publication_changes',[admin,'list','{}']),error=>error.code==='42501');
   }else{
    assert.equal((await workRpc('get',legacy.second.work)).work.visibility,'PRIVATE');
    assert.ok(Array.isArray((await rpc('admin_publication_changes',[admin,'list','{}'])).changes));
   }
  }finally{await db.exec('reset role');}
 }
});

test('migration replay preserves all requests/decisions and immutable-row protections',async()=>{
 const before=await reviewRows(),beforeMetadata=await identityMetadata();await db.exec(migration);await db.exec(migration);
 assert.deepEqual(await reviewRows(),before);assert.deepEqual(await identityMetadata(),beforeMetadata);
 assert.equal((await rows("select count(*)::int n from authoring.migrations where version='authoring-029'"))[0].n,1);
 await assert.rejects(db.query('update authoring.publication_changes set arguments=arguments where id=$1',[legacy.request.changeId]),/Workflow history is append-only/);
 await assert.rejects(db.query('delete from authoring.publication_change_decisions where change_id=$1',[legacy.request.changeId]),/Workflow history is append-only/);
});

test('unexpected function drift aborts the transaction without replacing a different implementation',async()=>{
 const original=(await rows("select pg_get_functiondef('authoring.review_change(text,uuid,bigint,jsonb,boolean)'::regprocedure) definition"))[0].definition;
 const drifted=original.replace('where user_id=u and work_id=w and kind=k and arguments=args;','where user_id=u and work_id = w and kind=k and arguments=args;');assert.notEqual(drifted,original);
 const before=await reviewRows();
 try{await db.exec(drifted);await assert.rejects(db.exec(migration),/Unexpected review receipt lookup/);}
 finally{await db.exec('rollback');await db.exec(original);}
 assert.deepEqual(await reviewRows(),before);
});

test('unreviewed application is rejected even after a successful earlier application',async()=>{
 const before=await reviewRows();await db.exec("set webnovels.authoring_apply_verified='false'");
 try{await assert.rejects(db.exec(migration),/Reviewed authoring-022 prerequisite required/);}
 finally{await db.exec("rollback;set webnovels.authoring_apply_verified='true'");}
 assert.deepEqual(await reviewRows(),before);
});
