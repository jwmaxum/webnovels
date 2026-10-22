// Offline rehearsal and guarded, operator-only migration. No public reset endpoint.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {reconstruct} from './prepare_stage34.mjs';
import {publicationFiles,packageSql,sourceGuards} from './prepare_stage33.mjs';
import {resetInventory,resetSql,clearedTables} from './lib/free-beta-reset.mjs';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import access from './lib/launch-access.cjs';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const files=[...publicationFiles,'database/authoring/024_free_beta_enrollment.sql',
 'database/launch/015_free_beta_accounts.sql','database/authoring/025_provider_settings.sql'];
export function preparedSql(snapshot,sha){
 assert.match(sha,/^[a-f0-9]{64}$/);
 return packageSql(files,sha).replace('begin;',()=>`begin;\n${sourceGuards(snapshot)}\nset local webnovels.workspace_backup_sha256='${sha}';\nset local webnovels.beta_test_data_reset='2026-10-22-authorized';\n${resetSql(snapshot)}`);
}
async function preservedAdmin(db,snapshot){
 for(const table of ['public.admin_users','public.audit_logs','auth.users','auth.identities','launch_recovery.admin_permission_audit','launch_recovery.account_audit']){
  const t=snapshot.tables.find(t=>t.schema+'.'+t.name===table);
  const rows=(await db.query('select to_jsonb(t)::text row from '+table+' t')).rows.map(r=>r.row);
  assert.equal(hash(rows.sort().join('\n')),hash([...t.rows].sort().join('\n')),'BETA_ADMIN_OR_AUTH_CHANGED:'+table);
 }
}
export async function rehearseStage35(snapshot,sha){
 const inventory=resetInventory(snapshot),{db,verified}=await restoreSnapshot(snapshot);
 try{
  await reconstruct(db,snapshot);
  for(const c of snapshot.columns.filter(c=>c.schema==='storage'&&c.default&&!c.generated))
   await db.exec(`alter table storage.${quote(c.table)} alter column ${quote(c.name)} set default ${c.default}`);
  for(const r of snapshot.relation_security.filter(r=>r.kind==='r'&&r.rls))await db.exec(`alter table ${quote(r.schema)}.${quote(r.name)} enable row level security`);
  const sql=preparedSql(snapshot,sha);await db.exec(sql);
  await preservedAdmin(db,snapshot);
  for(const t of clearedTables)assert.equal((await db.query('select count(*)::int n from '+t)).rows[0].n,0,'BETA_TEST_ROWS_REMAIN:'+t);
  assert.equal((await db.query('select new_serials_ready() r')).rows[0].r,false);
  assert.equal((await db.query('select free_beta_enrollment_config() r')).rows[0].r.enabled,false);
  // The migration itself is repeatable, but the destructive reset is intentionally one-time.
  await db.exec(packageSql(files.slice(publicationFiles.length),sha));
  await db.exec('begin;update authoring.new_serial_service set enabled=true;update authoring.free_beta_settings set enabled=true');
  try{
   const call=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
   assert.equal(await call('new_serials_ready'),true);
   assert.equal(await call('free_beta_enrollment_launch_ready'),true);
   const a=randomUUID(),b=randomUUID();
   await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,now(),false),($3,$4,now(),false)',[a,'stage35-author@example.test',b,'stage35-reader@example.test']);
   const d=(await db.query("select * from authoring.enrollment_documents where id='copyright-own'")).rows[0];
   const author=await call('free_beta_enrollment',[a,'complete',{kind:'author',displayName:'무료베타작가',rightsBasis:'OWN',rightsAccepted:true,documentVersion:d.version,documentHash:d.hash}]);
   assert.equal(author.completed,true,JSON.stringify(author));
   const reader=await call('free_beta_enrollment',[b,'complete',{kind:'reader',displayName:'무료베타독자'}]);
   assert.equal(reader.completed,true,JSON.stringify(reader));
   assert.equal((await call('launch_account_actor',[a])).author.identity_verified,false);
   const works=[];
   for(const contentType of ['NOVEL','WEBTOON']){
    const result=await call('creator_works',[a,'create',null,{title:'베타 인수 '+contentType,contentType},randomUUID()]);
    assert.ok(result.work,JSON.stringify(result));works.push(result.work);
   }
   const work=works[0];
   const updated=await call('creator_works',[a,'update',work.id,{version:work.version,description:'무료 베타 인수',genre:['판타지'],rating:'ALL',ai_usage_type:'NONE'}]);
   assert.ok(updated.work,JSON.stringify(updated));
   const draft=randomUUID();
   const saved=await call('creator_drafts',[a,'save',work.id,draft,{expectedRevision:'0',title:'첫 회차',content:'무료 베타의 원고입니다.',authorComment:''},randomUUID()]);
   assert.ok(saved.draft,JSON.stringify(saved));
   const published=await call('creator_publications_v18',[a,'publish',work.id,draft,null,{revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true},randomUUID()]);
   assert.ok(published.publication,JSON.stringify(published));
   assert.equal((await call('stage18_episode_content',[published.publication.episodeId])).episode.content,'무료 베타의 원고입니다.');
   assert.deepEqual((await call('stage18_catalog',['list',{type:'NOVEL'}])).works.map(w=>String(w.id)),[String(work.id)]);
   assert.equal((await call('creator_works',[b,'get',work.id])).error,'AUTHOR_REQUIRED');
   assert.equal((await db.query('select count(*)::int n from authoring.free_beta_publication_consents')).rows[0].n,1);
  }finally{await db.exec('rollback');}
  await preservedAdmin(db,snapshot);
  return {engine:'PGlite actual snapshot, constraints, defaults and app routines',originalTables:verified.length,
   clearedTables:clearedTables.length,adminProfilesPreserved:inventory.adminProfiles,authUsersPreservedDuringDatabaseMigration:true,
   freeSignup:true,novelAndWebtoonRegistration:true,novelFirstPublishAndRead:true,consentReceipt:true,
   activationRemainsOff:true,hostedAcceptance:false,browserAcceptance:false};
 }finally{await db.close();}
}
async function main(){
 const directory=await privateBackupDirectory(process.argv[2]);
 if(process.argv.slice(3).some(v=>v!=='--apply-reset'&&!v.startsWith('--native-backup=')))throw Error('BETA_ARGUMENT_INVALID');
 const {snapshot,manifest,hash:sha}=await readVerifiedSnapshot(directory),inventory=resetInventory(snapshot);
 const rehearsal=await rehearseStage35(snapshot,sha),sql=preparedSql(snapshot,sha);
 const report={checkedAt:new Date().toISOString(),snapshotSha256:sha,migrationSha256:hash(sql),files,rehearsal,
  adminProfiles:inventory.adminProfiles,authRetained:inventory.retainedAuthIds.length,authDeletionPending:inventory.deleteAuthIds.length,
  productionApplied:false,activated:false};
 if(process.argv.includes('--apply-reset')){
  if(!Number.isFinite(Date.parse(snapshot.captured_at))||Date.now()-Date.parse(snapshot.captured_at)>24*3600000||Date.parse(snapshot.captured_at)>Date.now())throw Error('BETA_FRESH_BACKUP_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);if(ref!==manifest.projectRef)throw Error('BETA_TARGET_MISMATCH');
  const nativeArg=process.argv.find(v=>v.startsWith('--native-backup='));
  if(!nativeArg)throw Error('BETA_NATIVE_BACKUP_REQUIRED');
  const nativeDirectory=fs.realpathSync(nativeArg.slice('--native-backup='.length));
  if(!nativeDirectory.startsWith(fs.realpathSync('scratch/launch/backups')+path.sep))throw Error('BETA_NATIVE_BACKUP_PATH');
  const native=JSON.parse(fs.readFileSync(path.join(nativeDirectory,'manifest.json')));
  assert.equal(native.projectRef,ref);assert.equal(native.archiveReadable,true);
  assert.equal(hash(fs.readFileSync(path.join(nativeDirectory,'application-auth-storage.dump'))),native.sha256,'BETA_NATIVE_BACKUP_HASH_MISMATCH');
  if(!Number.isFinite(Date.parse(native.createdAt))||Date.now()-Date.parse(native.createdAt)>24*3600000||Date.parse(native.createdAt)>Date.now())throw Error('BETA_NATIVE_BACKUP_REQUIRED');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
   headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false})});
  if(!response.ok){fs.writeFileSync('scratch/launch/stage35-apply-error-private.json',await response.text());throw Error('BETA_APPLY_FAILED');}
  report.productionApplied=true;
 }
 fs.writeFileSync('artifacts/stage35-preparation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 console.error(/^BETA_[A-Z0-9_]+$/.test(e.message)?e.message:'BETA_PREPARATION_FAILED');process.exitCode=1;
});
