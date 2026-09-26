// Private author rollout on a real backup; no P0 marker, publication or browser grants.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const hash=(x,alg='sha256')=>crypto.createHash(alg).update(x).digest('hex');
const q=x=>'"'+x.replaceAll('"','""')+'"';
const lit=x=>"'"+x.replaceAll("'","''")+"'";
export const workspaceFiles=['database/launch/007_author_workspace_prerequisite.sql',
  ...['001_authoring_foundation','003_verified_identity_link','004_auth_onboarding','005_creator_works','006_creator_drafts'].map(n=>'database/authoring/'+n+'.sql'),
  'database/launch/008_author_workspace_activation.sql'];
export function workspaceSql(sha){
  assert.match(sha,/^[a-f0-9]{64}$/);
  return `begin; set local lock_timeout='5s'; set local statement_timeout='60s';
set local webnovels.authoring_apply_verified='true'; set local webnovels.workspace_backup_sha256='${sha}';\n`+
    workspaceFiles.map(f=>fs.readFileSync(f,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n')+'\ncommit;';
}
export async function verifyWorkspace(db,users){
  const [author,other,reader]=users;
  const call=async(action,{user=author,id=null,data={},key=null}={})=>(await db.query(
    'select creator_works($1,$2,$3,$4,$5) value',[user,action,id,data,key])).rows[0].value;
  const original=await call('list');assert.ok(original.works.length);
  const own=original.works[0];assert.equal((await call('get',{user:other,id:own.id})).status,404);
  assert.equal((await call('list',{user:reader})).status,403);
  await db.exec('begin');
  try{
    const key=crypto.randomUUID(),created=await call('create',{data:{title:'Private workspace transaction verification'},key});
    assert.equal(created.created,true);assert.equal(created.work.visibility,'PRIVATE');
    assert.equal((await call('create',{data:{title:'Private workspace transaction verification'},key})).work.id,created.work.id);
    const id=created.work.id;
    const saved=await call('update',{id,data:{version:created.work.version,description:'Verified private metadata'}});
    assert.equal(saved.work.description,'Verified private metadata');
    assert.equal((await call('update',{id,data:{version:created.work.version,title:'stale'}})).status,409);
    assert.equal((await call('update',{id,user:other,data:{version:saved.work.version,title:'denied'}})).status,404);
    assert.equal((await call('update',{id,data:{version:saved.work.version,is_top_recommended:true}})).status,400);
    const draftId=crypto.randomUUID(),requestKey=crypto.randomUUID();
    const draft=async(action,data={},user=author,key=null)=>(await db.query(
      'select creator_drafts($1,$2,$3,$4,$5,$6) value',[user,action,id,draftId,data,key])).rows[0].value;
    const content={expectedRevision:'0',title:'원고 검증',content:'보존할 원고\n둘째 문단',authorComment:'작가의 말'};
    const one=await draft('save',content,author,requestKey);assert.equal(one.draft.revision,'1');
    const two=await draft('save',{...content,expectedRevision:'1',content:'수정된 원고'},author,crypto.randomUUID());assert.equal(two.draft.revision,'2');
    assert.equal((await draft('save',content,author,requestKey)).draft.revision,'1');
    assert.equal((await draft('save',content,author,crypto.randomUUID())).status,409);
    assert.equal((await draft('get')).draft.content,'수정된 원고');
    const history=await draft('history');assert.equal(history.revisions.length,2);assert.equal(history.revisions[1].content,content.content);
    assert.equal((await draft('get',{},other)).status,404);assert.equal((await draft('get',{},reader)).status,403);
    for(const role of ['anon','authenticated']){
      await db.exec('savepoint role_check;set local role '+role);
      await assert.rejects(db.query('select creator_drafts($1,$2,$3)',[author,'list',id]),/permission denied/);
      await db.exec('rollback to role_check;release role_check');
    }
  }finally{await db.exec('rollback');}
  return {ownedWorksRead:true,privateWorkCreateAndUpdate:true,idempotency:true,draftSaveReadAndHistory:true,
    staleWorkAndDraftRejected:true,crossAuthorDenied:true,readerDenied:true,browserRpcDenied:true,transactionRolledBack:true};
}
export async function rehearseWorkspace(snapshot,sha){
  const {db}=await restoreSnapshot(snapshot);
  try{
    await db.exec('create role anon;create role authenticated;create role service_role;');
    for(const s of snapshot.sequences.filter(s=>s.schemaname==='public')){
      await db.exec(`create sequence ${q(s.schemaname)}.${q(s.sequencename)} start with ${Math.max(Number(s.last_value||1),1)};`);
      await db.query('select setval($1,$2,true)',['public.'+s.sequencename,Math.max(Number(s.last_value||1),1)]);
    }
    for(const c of snapshot.columns.filter(c=>['public','launch_recovery'].includes(c.schema)&&c.default&&!c.generated))
      await db.exec(`alter table ${q(c.schema)}.${q(c.table)} alter column ${q(c.name)} set default ${c.default}`);
    for(const c of snapshot.columns.filter(c=>c.schema==='public'&&c.identity)){
      const seq=snapshot.sequences.find(s=>s.schemaname==='public'&&s.sequencename===c.table+'_'+c.name+'_seq');
      if(!seq)throw Error('IDENTITY_SEQUENCE_REVIEW_REQUIRED');
      await db.exec(`alter table public.${q(c.table)} alter column ${q(c.name)} set default nextval(${lit('public.'+seq.sequencename)}::regclass)`);
    }
    await db.exec(fs.readFileSync('database/launch/004_virtual_accounts.sql','utf8'));
    await db.exec("set webnovels.containment_reviewed='true'");
    await db.exec(fs.readFileSync('database/p0/003_maintenance_containment.sql','utf8'));
    await db.exec(workspaceSql(sha));
    const authors=snapshot.tables.find(t=>t.schema==='public'&&t.name==='authors').rows.map(JSON.parse).filter(a=>a.auth_user_id).sort((a,b)=>a.id-b.id);
    const reader=snapshot.tables.find(t=>t.schema==='public'&&t.name==='readers').rows.map(JSON.parse).find(r=>r.auth_user_id);
    const verification=await verifyWorkspace(db,[authors[0].auth_user_id,authors[1].auth_user_id,reader.auth_user_id]);
    for(const t of snapshot.tables.filter(t=>t.schema==='public')){
      const rows=(await db.query(`select to_jsonb(t)::text row from public.${q(t.name)} t`)).rows.map(x=>x.row);
      assert.equal(hash(rows.sort().join('\n')),hash([...t.rows].sort().join('\n')),'Public data changed: '+t.name);
    }
    assert.equal((await db.query('select launch_author_workspace_ready() ready')).rows[0].ready,true);
    assert.equal((await db.query("select to_regclass('public.p0_migration_status') marker")).rows[0].marker,null);
    const preservedDrafts=(await db.query('select count(*)::int n from authoring.drafts where legacy_draft_id is not null')).rows[0].n;
    await db.exec(workspaceSql(sha)); // Idempotent deployment must preserve imported revisions.
    await db.exec('grant update on works to authenticated');
    assert.equal((await db.query('select launch_author_workspace_ready() ready')).rows[0].ready,false);
    return {...verification,publicTablesPreserved:snapshot.tables.filter(t=>t.schema==='public').length,
      legacyDraftsPreserved:preservedDrafts,publicationUnchanged:true,permissionDriftClosesReadiness:true};
  }finally{await db.close();}
}
async function main(){
 const directory=path.resolve(process.argv[2]||'');
 if(!directory.startsWith(path.resolve('scratch/launch/backups')+path.sep))throw Error('PRIVATE_BACKUP_REQUIRED');
 const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),sha=hash(bytes),snapshot=JSON.parse(bytes);
 assert.equal(sha,JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))).snapshotSha256);
 const rehearsal=await rehearseWorkspace(snapshot,sha);
 const sql=workspaceSql(sha),report={checkedAt:new Date().toISOString(),snapshotSha256:sha,migrationSha256:hash(sql),
   localProductionDataRehearsal:rehearsal,productionApplied:false,browserAcceptance:false,hostedSupabaseRestore:false};
 if(process.argv.includes('--apply')){
   // Abort rather than overwrite any public row changed since the reviewed snapshot.
   const guards=snapshot.tables.filter(t=>t.schema==='public').map(t=>{
     const expected=hash(t.rows.map(r=>hash(r,'md5')).sort().join('\n'),'md5');
     return `lock table public.${q(t.name)} in share row exclusive mode;
do $guard$ begin if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text),chr(10) order by md5(to_jsonb(t)::text)),'')) from public.${q(t.name)} t)<>${lit(expected)} then raise exception 'SOURCE_CHANGED'; end if; end $guard$;`;
   }).join('\n');
   const env=access.loadEnv(),{ref}=access.connection(env);
   const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
     headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql.replace('begin;',()=>`begin;\n${guards}`),read_only:false})});
   if(!response.ok){fs.writeFileSync('scratch/launch/author-workspace-apply-error-private.json',await response.text());throw Error('DATABASE_APPLY_FAILED');}
   report.productionApplied=true;
   // The management read-only role cannot execute the service-only readiness RPC.
   report.productionState=await backup.query("select (select enabled from launch_recovery.author_workspace_service where version='workspace-20260926') enabled,(select count(*) from authoring.drafts where legacy_draft_id is not null) imported_drafts,(select count(*) from authoring.identity_evidence) identity_evidence,to_regclass('public.p0_migration_status')::text p0_marker");
 }
 fs.writeFileSync('artifacts/author-workspace-rollout.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(e=>{fs.writeFileSync('scratch/launch/author-workspace-preparation-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack},null,2));console.error(/^[A-Z_]+$/.test(e.message)?e.message:'AUTHOR_WORKSPACE_PREPARATION_FAILED');process.exitCode=1;});
