// Rehearse against actual backed-up rows. --apply installs registration/foundation ONLY.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {workspaceSql,verifyWorkspace} from './prepare_author_workspace.mjs';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const q=x=>'"'+x.replaceAll('"','""')+'"',lit=x=>"'"+x.replaceAll("'","''")+"'";
const hash=(x,alg='sha256')=>createHash(alg).update(x).digest('hex');
export const registrationFiles=['database/launch/010_multiformat_registration.sql','database/launch/011_new_serial_foundation.sql'];
export const publicationFiles=['database/launch/013_free_serial_prerequisites.sql',...['002_private_storage','007_creator_files','008_creator_publications','009_creator_reader_operations','010_admin_operations','011_reader_profile_cutover','012_creator_distribution','013_reader_discovery','014_admin_workflow','015_webtoon','021_manuscript_documents','022_publication_change_review'].map(n=>'database/authoring/'+n+'.sql'),'database/launch/012_new_serial_publication_scope.sql'];
export function packageSql(files,sha){
 assert.match(sha,/^[a-f0-9]{64}$/);
 return `begin; set local lock_timeout='5s'; set local statement_timeout='60s';
 set local webnovels.authoring_apply_verified='true'; set local webnovels.workspace_backup_sha256='${sha}';\n`+
 files.map(f=>fs.readFileSync(f,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n')+'\ncommit;';
}
export function sourceGuards(snapshot){
 return snapshot.tables.filter(t=>['public','authoring','launch_recovery'].includes(t.schema)||t.schema==='auth'&&['users','identities'].includes(t.name)).map(t=>{
  const expected=hash(t.rows.map(r=>hash(r,'md5')).sort().join('\n'),'md5'),name=q(t.schema)+'.'+q(t.name);
  return `lock table ${name} in share row exclusive mode;
 do $guard$ begin if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text),chr(10) order by md5(to_jsonb(t)::text)),'')) from ${name} t)<>${lit(expected)} then raise exception 'STAGE33_SOURCE_CHANGED'; end if; end $guard$;`;
 }).join('\n');
}
async function preserved(db,snapshot){
 for(const t of snapshot.tables){
  const cols=snapshot.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.ordinal-b.ordinal).map(c=>q(c.name));
  let rows=(await db.query(`select to_jsonb(original)::text row from (select ${cols.join(',')} from ${q(t.schema)}.${q(t.name)}) original`)).rows.map(r=>r.row);
  if(t.schema==='authoring'&&t.name==='migrations')rows=rows.filter(r=>t.rows.includes(r));
  if(t.schema==='storage'&&t.name==='buckets')rows=rows.filter(r=>t.rows.includes(r)||!['authoring-originals','authoring-covers','authoring-webtoons'].includes(JSON.parse(r).id));
  assert.equal(hash(rows.sort().join('\n')),hash([...t.rows].sort().join('\n')),'STAGE33_ORIGINAL_ROWS_CHANGED:'+t.schema+'.'+t.name);
 }
}
async function reconstructWorkspace(db,snapshot,sha){
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const s of snapshot.sequences.filter(s=>['public','authoring','launch_recovery'].includes(s.schemaname))){
  await db.exec(`create sequence ${q(s.schemaname)}.${q(s.sequencename)};`);
  await db.query('select setval($1,$2,true)',[s.schemaname+'.'+s.sequencename,Math.max(Number(s.last_value||1),1)]);
 }
 for(const c of snapshot.columns.filter(c=>['public','authoring','launch_recovery','storage'].includes(c.schema)&&c.default&&!c.generated))
  await db.exec(`alter table ${q(c.schema)}.${q(c.table)} alter column ${q(c.name)} set default ${c.default}`);
 for(const c of snapshot.columns.filter(c=>['public','authoring'].includes(c.schema)&&c.identity)){
  const s=snapshot.sequences.find(s=>s.schemaname===c.schema&&s.sequencename===c.table+'_'+c.name+'_seq');
  if(!s)throw Error('STAGE33_SEQUENCE_REVIEW_REQUIRED');
  await db.exec(`alter table ${q(c.schema)}.${q(c.table)} alter column ${q(c.name)} set default nextval(${lit(c.schema+'.'+s.sequencename)}::regclass)`);
 }
 await db.exec(fs.readFileSync('database/launch/004_virtual_accounts.sql','utf8'));
 await db.exec("set webnovels.containment_reviewed='true'");
 await db.exec(fs.readFileSync('database/p0/003_maintenance_containment.sql','utf8'));
 await db.exec(workspaceSql(sha));
 await db.exec('alter table storage.objects enable row level security');
}
export async function rehearseStage33(snapshot,sha){
 const {db,verified}=await restoreSnapshot(snapshot);
 try{
  await reconstructWorkspace(db,snapshot,sha);await preserved(db,snapshot);
  const guarded=packageSql(registrationFiles,sha).replace('begin;',()=>`begin; set local lock_timeout='5s'; set local statement_timeout='60s';\n${sourceGuards(snapshot)}`);
  await db.exec(guarded);await db.exec(packageSql(registrationFiles,sha));
  const authors=snapshot.tables.find(t=>t.schema==='public'&&t.name==='authors').rows.map(JSON.parse).filter(a=>a.auth_user_id&&a.status==='APPROVED');
  const reader=snapshot.tables.find(t=>t.schema==='public'&&t.name==='readers').rows.map(JSON.parse).find(r=>r.auth_user_id&&r.status==='ACTIVE');
  assert.ok(authors.length>=2&&reader,'STAGE33_FIXTURE_ACCOUNTS_REQUIRED');
  await verifyWorkspace(db,[authors[0].auth_user_id,authors[1].auth_user_id,reader.auth_user_id]);
  await db.exec('begin;set local role service_role');
  try{
   assert.equal((await db.query('select launch_work_registration_ready() ready')).rows[0].ready,true);
   for(const type of ['NOVEL','WEBTOON']){
    const args=[authors[0].auth_user_id,'create',null,{title:'Registration transaction verification',contentType:type},randomUUID()];
    const r=(await db.query('select creator_works($1,$2,$3,$4,$5) result',args)).rows[0].result;
    assert.equal(r.work?.content_type,type,'STAGE33_TYPED_REGISTRATION_FAILED');
    assert.equal((await db.query('select creator_works($1,$2,$3,$4,$5) result',args)).rows[0].result.work.id,r.work.id);
   }
  }finally{await db.exec('rollback');}
  await preserved(db,snapshot);
  const counts=(await db.query(`select (select count(*)::int from authoring.legacy_work_scope) works,
   (select count(*)::int from authoring.legacy_episode_scope) episodes,(select count(*)::int from authoring.drafts) drafts,
   (select count(*)::int from authoring.draft_revisions) revisions`)).rows[0];
  // A changed original aborts before any migration can be replayed.
  await db.exec('begin');
  await db.exec("update public.works set description=coalesce(description,'')||' CAS check' where id=(select min(id) from public.works)");
  await assert.rejects(db.exec(sourceGuards(snapshot)),/STAGE33_SOURCE_CHANGED/);await db.exec('rollback');
  await db.exec(packageSql(publicationFiles,sha));await db.exec(packageSql(['database/launch/012_new_serial_publication_scope.sql'],sha));
  await preserved(db,snapshot);
  assert.equal((await db.query('select new_serials_ready() ready')).rows[0].ready,false);
  assert.equal((await db.query("select to_regclass('public.p0_migration_status') marker")).rows[0].marker,null);
  // Exercise the actual legacy column types; no real account/work is mutated.
  await db.exec('begin;update authoring.new_serial_service set enabled=true');
  try{
   const rpc=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
   const user=authors[0].auth_user_id;
   const w=(await rpc('creator_works',[user,'create',null,{title:'Free serial transaction verification',contentType:'NOVEL'},randomUUID()])).work;
   assert.ok(w,'STAGE33_FREE_WORK_FAILED');
   assert.ok((await rpc('creator_works',[user,'update',w.id,{version:w.version,description:'Verified introduction',genre:['판타지'],rating:'ALL',ai_usage_type:'NONE'}])).work,'STAGE33_FREE_METADATA_FAILED');
   const draft=randomUUID();
   assert.ok((await rpc('creator_drafts',[user,'save',w.id,draft,{expectedRevision:'0',title:'First chapter',content:'Synthetic acceptance text',authorComment:''},randomUUID()])).draft,'STAGE33_FREE_DRAFT_FAILED');
   const p=(await rpc('creator_publications_v18',[user,'publish',w.id,draft,null,{revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true},randomUUID()])).publication;
   assert.ok(p,'STAGE33_FREE_PUBLICATION_FAILED');
   assert.equal((await rpc('stage18_episode_content',[p.episodeId])).episode.content,'Synthetic acceptance text');
   assert.deepEqual((await rpc('stage18_catalog',['list',{type:'NOVEL'}])).works.map(w=>w.id),[w.id]);
   const position={workId:w.id,episodeId:p.episodeId};
   const comment=await rpc('stage8_reader',[reader.auth_user_id,'comment',{...position,content:'Synthetic acceptance comment'}]);
   assert.ok(!comment.error,'STAGE33_COMMENT_FAILED:'+comment.error);
   assert.equal((await rpc('stage8_reader',[reader.auth_user_id,'comments',position])).comments.length,1);
   const state=(await rpc('creator_works',[user,'get',w.id])).work;
   assert.equal((await rpc('creator_works',[user,'update',w.id,{version:state.version,title:'Pending review'}])).reviewRequired,true);
  }finally{await db.exec('rollback');}
  await preserved(db,snapshot);
  return {engine:'PGlite with actual backup rows and reconstructed application functions',originalRowsMatch:true,
   originalTables:verified.length,originalRows:verified.reduce((n,t)=>n+t.rows,0),...counts,
   bothTypesSameAuthor:true,receiptRetry:true,ownershipAndDraftRevisions:true,sourceChangeRejected:true,
   registrationRepeatable:true,freePublicationDependenciesAppliedLocally:true,scopeRepeatable:true,
   actualSchemaFirstPublicationAndReader:true,actualSchemaComments:true,actualSchemaReview:true,
   originalP0MarkerAbsent:true,publicActivation:false,hostedSupabaseAcceptance:false,multiConnectionAcceptance:false};
 }finally{await db.close();}
}
async function main(){
 const directory=await privateBackupDirectory(process.argv[2]);
 if(process.argv.slice(3).some(a=>a!=='--apply'))throw Error('STAGE33_ARGUMENT_INVALID');
 const {snapshot,manifest,hash:sha}=await readVerifiedSnapshot(directory);
 const sql=packageSql(registrationFiles,sha),rehearsal=await rehearseStage33(snapshot,sha);
 const report={checkedAt:new Date().toISOString(),snapshotSha256:sha,registrationSqlSha256:hash(sql),
  registrationFiles,publicationFiles,rehearsal,productionApplied:false,publicationApplied:false,flagsChanged:false,browserAcceptance:false};
 if(process.argv.includes('--apply')){
  if(Date.now()-Date.parse(snapshot.captured_at)>24*3600000)throw Error('STAGE33_FRESH_BACKUP_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);if(ref!==manifest.projectRef)throw Error('STAGE33_SOURCE_MISMATCH');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
   headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},
   body:JSON.stringify({query:sql.replace('begin;',()=>`begin; set local lock_timeout='5s'; set local statement_timeout='60s';\n${sourceGuards(snapshot)}`),read_only:false})});
  if(!response.ok){fs.writeFileSync('scratch/launch/stage33-apply-error-private.json',await response.text());throw Error('STAGE33_APPLY_FAILED');}
  report.productionApplied=true;
  report.productionState=await backup.query(`select (select count(*)::int from authoring.legacy_work_scope) legacy_works,
   (select count(*)::int from authoring.legacy_episode_scope) legacy_episodes,
   (select count(*)::int from authoring.drafts) drafts,(select count(*)::int from authoring.draft_revisions) revisions,
   (select enabled from authoring.new_serial_service) public_enabled,to_regclass('public.p0_migration_status')::text p0_marker`);
 }
 fs.writeFileSync('artifacts/stage33-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(e=>{fs.writeFileSync('scratch/launch/stage33-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack},null,2));console.error(/^STAGE33_[A-Z_]+$/.test(e.message)?e.message:'STAGE33_REHEARSAL_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
