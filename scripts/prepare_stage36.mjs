// Additive support/operations only. No reset, enrollment, publication or provider activation.
import fs from 'node:fs';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {reconstruct} from './prepare_stage34.mjs';
import {packageSql} from './prepare_stage33.mjs';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {restorePreparation} from './lib/launch-restore-plan.mjs';
import scope from './lib/launch-backup-scope.cjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';

export const stage36Files=['database/authoring/026_beta_support.sql','database/authoring/027_beta_operations.sql'];
const versions=['authoring-026','authoring-027'];
const tables=['support_cases','support_messages','support_receipts','support_limits','beta_operation_minutes','beta_operation_errors','beta_operation_maintenance'];
const routines=['public.beta_support(uuid,boolean,text,jsonb)','public.record_beta_operation(uuid,text,integer,integer)',
 'public.maintain_beta_operations()','public.beta_operations_dashboard(uuid)'];
const internalRoutines=['authoring.support_summary(authoring.support_cases)','authoring.support_detail(uuid)'];
const q=s=>'"'+s.replaceAll('"','""')+'"',lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
const rowHash=rows=>hash(rows.map(row=>hash(row,'md5')).sort().join('\n'),'md5');
const ordered=a=>JSON.stringify([...a].sort());
const error=code=>{throw Error('STAGE36_'+code);};
const timestampFresh=(value,now=Date.now())=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<=24*3600000;

export function validateStage36Snapshot(snapshot){
 if(snapshot?.format!=='webnovels-logical-data-v1'||!Array.isArray(snapshot.requested_schemas)||ordered(snapshot.requested_schemas)!==ordered(scope.schemas))error('SNAPSHOT_SCOPE_REQUIRED');
 if(!Array.isArray(snapshot.tables)||!Array.isArray(snapshot.columns)||!Array.isArray(snapshot.functions)||!Array.isArray(snapshot.triggers)||!Array.isArray(snapshot.sequences))error('SNAPSHOT_CATALOG_REQUIRED');
 scope.inventoryKeys(snapshot.tables.map(t=>({...t,kind:'r'})));
 for(const t of snapshot.tables)if(!Array.isArray(t.rows)||t.rows.length!==Number(t.row_count)||!snapshot.columns.some(c=>c.schema===t.schema&&c.table===t.name))error('SNAPSHOT_INCOMPLETE');
 const migrations=snapshot.tables.find(t=>t.schema==='authoring'&&t.name==='migrations');
 if(!migrations||!migrations.rows.some(r=>JSON.parse(r).version==='authoring-015'))error('WEBTOON_FOUNDATION_REQUIRED');
 for(const name of ['auth.users','public.authors','public.readers','public.admin_users'])if(!snapshot.tables.some(t=>t.schema+'.'+t.name===name))error('ACCOUNT_FOUNDATION_REQUIRED');
}

// Check the full backed-up scope in one repeatable-read snapshot. App tables are
// write-locked; managed Auth/Storage tables require only their existing SELECT
// rights and remain writable by the provider. Post-apply drift requires review.
export function stage36SourceGuards(snapshot){
 validateStage36Snapshot(snapshot);
 const expected=scope.inventoryKeys(snapshot.tables.map(t=>({...t,kind:'r'}))).join('\n');
 const orderedTables=[...snapshot.tables].sort((a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name));
 // Acquire all locks before the first snapshot-taking SELECT. No ownership or
 // managed-schema grants are changed to obtain a stronger provider-table lock.
 let sql=orderedTables.map(t=>`lock table ${q(t.schema)}.${q(t.name)} in ${scope.applicationSchemas.includes(t.schema)?'share row exclusive':'access share'} mode;`).join('\n')+'\n';
 sql+=`do $scope$ begin if (select string_agg(schema||'.'||name,chr(10) order by schema,name) from (${scope.inventorySql}) x) is distinct from ${lit(expected)} then raise exception 'STAGE36_SOURCE_SCOPE_CHANGED';end if;end $scope$;\n`;
 sql+=orderedTables.map(t=>{
  const name=q(t.schema)+'.'+q(t.name);
  return `do $guard$ begin if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text),chr(10) order by md5(to_jsonb(t)::text)),'')) from ${name} t)<>${lit(rowHash(t.rows))} then raise exception 'STAGE36_SOURCE_CHANGED';end if;end $guard$;`;
 }).join('\n');
 return sql;
}
export function stage36PreparedSql(snapshot,sha){
 assert.match(sha,/^[a-f0-9]{64}$/);
 return packageSql(stage36Files,sha).replace('begin;',()=>`begin;\nset transaction isolation level repeatable read;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\n${stage36SourceGuards(snapshot)}`);
}
function originalRowsQuery(snapshot,t){
 const cols=snapshot.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.ordinal-b.ordinal).map(c=>q(c.name));
 let where='';
 if(t.schema==='authoring'&&t.name==='migrations'){
  const originals=new Set(t.rows.map(r=>JSON.parse(r).version)),added=versions.filter(v=>!originals.has(v));
  if(added.length)where=' where version not in ('+added.map(lit).join(',')+')';
 }
 return `select ${cols.join(',')} from ${q(t.schema)}.${q(t.name)}${where}`;
}
export async function verifyStage36Preservation(db,snapshot){
 for(const t of snapshot.tables){
  const rows=(await db.query('select to_jsonb(original)::text row from ('+originalRowsQuery(snapshot,t)+') original')).rows.map(r=>r.row);
  if(rowHash(rows)!==rowHash(t.rows))error('ORIGINAL_ROWS_CHANGED');
 }
 return true;
}
function aclSql(){
 return `select
 (select count(*)=7 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='authoring' and c.relname in (${tables.map(lit).join(',')})) rls_enabled,
 not exists(select 1 from unnest(array[${tables.map(lit).join(',')}]) t cross join unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,'authoring.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r,'authoring.'||t,'SELECT,INSERT,UPDATE,REFERENCES')) direct_access_denied,
 not exists(select 1 from unnest(array[${routines.map(lit).join(',')}]) f cross join unnest(array['anon','authenticated']) r where has_function_privilege(r,f,'EXECUTE')) browser_rpc_denied,
 (select bool_and(has_function_privilege('service_role',f,'EXECUTE')) from unnest(array[${routines.map(lit).join(',')}]) f) service_rpc_granted,
 not exists(select 1 from unnest(array[${internalRoutines.map(lit).join(',')}]) f cross join unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r,f,'EXECUTE')) helper_rpc_denied,
 (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid=any(array[${routines.map(f=>lit(f)+'::regprocedure').join(',')}])) definer_path_fixed`;
}
async function verifyPermissions(db){
 const result=(await db.query(aclSql())).rows[0];
 if(Object.values(result).some(v=>v!==true))error('EXPLICIT_GRANTS_INVALID');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   for(const table of tables)await assert.rejects(db.query('select * from authoring.'+table),/permission denied/);
   if(role==='service_role')assert.equal((await db.query("select public.beta_support(null,false,'list','{}') r")).rows[0].r.error,'ACCOUNT_REQUIRED');
   else await assert.rejects(db.query("select public.beta_support(null,false,'list','{}')"),/permission denied/);
  }finally{await db.exec('reset role');}
 }
 return {privateTables:tables.length,serviceOnlyRpcs:routines.length,explicitGrants:true,rlsEnabled:true,roleChecks:true};
}
export async function rehearseStage36(snapshot,sha){
 validateStage36Snapshot(snapshot);
 const {db,verified}=await restoreSnapshot(snapshot);
 try{
  await reconstruct(db,snapshot);await verifyStage36Preservation(db,snapshot);
  await db.exec('begin');
  try{await db.exec(stage36SourceGuards(snapshot));}finally{await db.exec('rollback');}
  await db.exec('begin');
  try{
   await db.exec("insert into authoring.migrations(version) values('stage36-synthetic-source-drift')");
   await assert.rejects(db.exec(stage36SourceGuards(snapshot)),/STAGE36_SOURCE_CHANGED/);
  }finally{await db.exec('rollback');}
  await db.exec(stage36PreparedSql(snapshot,sha));
  await db.exec(packageSql(stage36Files,sha));
  await verifyStage36Preservation(db,snapshot);
  const permissions=await verifyPermissions(db);
  await verifyStage36Preservation(db,snapshot);
  return {engine:'PGlite restored snapshot rows, constraints, defaults and application routines',
   originalTables:verified.length,originalRows:verified.reduce((n,t)=>n+t.rows,0),originalRowsMatch:true,
   migrationMarkersAddedOnly:true,flagsUnchanged:true,migrationRepeatable:true,sourceDriftRejected:true,...permissions,
   sourceIsolation:'REPEATABLE READ',managedProviderWritesFrozen:false,postApplyDriftRequiresReview:true,
   destructiveReset:false,hostedRestoreAcceptance:false,multiConnectionAcceptance:false,browserAcceptance:false};
 }finally{await db.close();}
}
export function validateStage36Native(snapshot,logical,native,toc,archive,now=Date.now()){
 validateStage36Snapshot(snapshot);
 if(!timestampFresh(snapshot.captured_at,now)||!timestampFresh(native.createdAt,now))error('FRESH_BACKUPS_REQUIRED');
 if(archive.length!==native.bytes||hash(archive)!==native.sha256||archive.subarray(0,5).toString()!=='PGDMP')error('NATIVE_BACKUP_CHECKSUM');
 if(ordered(Object.keys(logical.rowCounts||{}))!==ordered(snapshot.tables.map(t=>t.schema+'.'+t.name))||
  snapshot.tables.some(t=>logical.rowCounts[t.schema+'.'+t.name]!==Number(t.row_count)))error('MANIFEST_SCOPE_MISMATCH');
 const preparation=restorePreparation(logical,native,toc);
 return {nativeArchiveSha256:preparation.nativeArchiveSha256,nativeArchiveVerified:true,nativeTables:preparation.tables,
  independentSnapshotTimes:true,combinedConsistentSnapshotConfirmed:false,hostedRestoreAccepted:false};
}
async function nativeEvidence(directory,snapshot,manifest){
 const root=await privateBackupDirectory(directory),names=['manifest.json','archive-toc.txt','application-auth-storage.dump'];
 const files=await Promise.all(names.map(name=>safeBundleFile(root,name)));
 for(const file of files)if((await lstat(file)).size>128*1024*1024)error('BACKUP_FILE_TOO_LARGE');
 const [metadata,toc,archive]=await Promise.all(files.map(file=>readFile(file)));
 return validateStage36Native(snapshot,manifest,JSON.parse(metadata),toc.toString('utf8'),archive);
}
function productionPreservationSql(snapshot){
 const checks=snapshot.tables.map(t=>`select (select md5(coalesce(string_agg(md5(to_jsonb(original)::text),chr(10) order by md5(to_jsonb(original)::text)),'')) from (${originalRowsQuery(snapshot,t)}) original)=${lit(rowHash(t.rows))} matches`);
 return `select (select bool_and(matches) from (${checks.join(' union all ')}) preserved) original_rows_match,acl.* from (${aclSql()}) acl`;
}
async function main(){
 const args=process.argv.slice(2),directory=args[0];
 if(!directory||directory.startsWith('--')||args.slice(1).some(v=>v!=='--apply'&&!v.startsWith('--native-backup='))||args.filter(v=>v==='--apply').length>1||args.filter(v=>v.startsWith('--native-backup=')).length>1)error('ARGUMENT_INVALID');
 const apply=args.includes('--apply'),nativeArg=args.find(v=>v.startsWith('--native-backup='));
 if(apply&&!nativeArg)error('NATIVE_BACKUP_REQUIRED');
 const verifiedDirectory=await privateBackupDirectory(directory),{snapshot,manifest,hash:sha}=await readVerifiedSnapshot(verifiedDirectory);
 const native=nativeArg?await nativeEvidence(nativeArg.slice('--native-backup='.length),snapshot,manifest):null;
 const rehearsal=await rehearseStage36(snapshot,sha),sql=stage36PreparedSql(snapshot,sha);
 const report={format:'webnovels-stage36-preparation-v1',checkedAt:new Date().toISOString(),projectRef:manifest.projectRef,
  snapshotSha256:sha,migrationSha256:hash(sql),files:stage36Files,rehearsal,native,
  applied:false,productionApplied:false,flagsChanged:false,destructiveReset:false,browserAcceptance:false};
 fs.mkdirSync('artifacts',{recursive:true});
 const save=()=>fs.writeFileSync('artifacts/stage36-preparation.json',JSON.stringify(report,null,2)+'\n');
 if(apply){
  if(!timestampFresh(snapshot.captured_at))error('FRESH_BACKUPS_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);if(ref!==manifest.projectRef)error('SOURCE_MISMATCH');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
   headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false})});
  if(!response.ok){fs.mkdirSync('scratch/launch',{recursive:true});fs.writeFileSync('scratch/launch/stage36-apply-error-private.json',await response.text(),{mode:0o600});error('APPLY_FAILED');}
  // Persist the known write outcome before the separate read-only check.
  report.applied=true;report.productionApplied=true;save();
  const state=(await backup.query(productionPreservationSql(snapshot)))[0];
  if(!state||Object.values(state).some(v=>v!==true))error('POST_APPLY_VERIFICATION_FAILED');
  report.productionState={originalRowsMatch:true,flagsUnchanged:true,privateTableAcl:true,serviceOnlyRpcs:true};
 }
 save();console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 fs.mkdirSync('scratch/launch',{recursive:true});
 fs.writeFileSync('scratch/launch/stage36-preparation-error-private.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack},null,2),{mode:0o600});
 console.error(/^STAGE36_[A-Z_]+$/.test(e.message)?e.message:'STAGE36_PREPARATION_FAILED_DETAILS_WITHHELD');process.exitCode=1;
});
