// Offline migration rehearsal on a verified backup. Hosted inspection is read-only.
// This command never applies SQL to Supabase, changes flags or selects a legacy body.
import {readFile,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,sha} from './lib/launch-content-review.mjs';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {restorePreparation} from './lib/launch-restore-plan.mjs';
import {inspectRestoreTarget} from './lib/restore-target.mjs';
import access from './lib/launch-access.cjs';

const quote=s=>'"'+s.replaceAll('"','""')+'"';
const fingerprint=rows=>sha([...rows].sort().join('\n'));
const migrationFile=new URL('../database/p0/001_expand_identity_content.sql',import.meta.url);

export async function rehearseExpansion(snapshot) {
  const migration=await readFile(migrationFile,'utf8');
  const {db,verified}=await restoreSnapshot(snapshot);
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    const beforeMarker=(await db.query("select to_regclass('public.p0_migration_status')::text marker")).rows[0].marker;
    let result='EXPANSION_APPLIED_LOCALLY';
    try {await db.exec(migration);}
    catch(error) {
      await db.exec('rollback');
      // Never serialize DB exceptions, which can contain manuscript or account data.
      result=error.message==='Legacy body sources disagree: reconcile verified content before expansion'
        ? 'LEGACY_CONTENT_CONFLICT'
        : error.message==='Legacy body source structure requires review before expansion'
          ? 'LEGACY_CONTENT_STRUCTURE_REVIEW_REQUIRED' : 'EXPANSION_REHEARSAL_FAILED';
    }
    for(const t of snapshot.tables) {
      const columns=snapshot.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.ordinal-b.ordinal);
      const rows=(await db.query(`select to_jsonb(original)::text row from
        (select ${columns.map(c=>quote(c.name)).join(',')} from ${quote(t.schema)}.${quote(t.name)}) original`)).rows.map(r=>r.row);
      if(fingerprint(rows)!==fingerprint(t.rows))throw Error('STAGE32_ORIGINAL_ROWS_CHANGED');
    }
    const afterMarker=(await db.query("select to_regclass('public.p0_migration_status')::text marker")).rows[0].marker;
    if(result!=='EXPANSION_APPLIED_LOCALLY'&&beforeMarker!==afterMarker)throw Error('STAGE32_ROLLBACK_FAILED');
    return {engine:'PGlite isolated in-memory PostgreSQL',migration:'database/p0/001_expand_identity_content.sql',
      migrationSha256:sha(migration),result,originalRowsMatch:true,tablesVerified:verified.length,
      rowsVerified:verified.reduce((sum,t)=>sum+t.rows,0),failedExpansionRolledBack:result!=='EXPANSION_APPLIED_LOCALLY',
      productionApplied:false,hostedRestoreAccepted:false,fullSchemaRestore:false,
      limitations:['This is an isolated data/constraint reconstruction, not hosted Auth, ACL, RLS, Storage, RPC or full native restore acceptance.',
        'Even successful local expansion is not permission to activate publishing or apply subsequent migrations.']};
  }finally{await db.close();}
}

export async function prepareStage32(logicalInput,nativeInput) {
  const logicalDirectory=await privateBackupDirectory(logicalInput),nativeDirectory=await privateBackupDirectory(nativeInput);
  const {snapshot,manifest:logical}=await readVerifiedSnapshot(logicalDirectory);
  const files=await Promise.all(['manifest.json','archive-toc.txt','application-auth-storage.dump'].map(n=>safeBundleFile(nativeDirectory,n)));
  for(const file of files)if((await lstat(file)).size>128*1024*1024)throw Error('STAGE32_FILE_TOO_LARGE');
  const [nativeBytes,toc,archive]=await Promise.all(files.map(f=>readFile(f)));
  const native=JSON.parse(nativeBytes);
  if(archive.length!==native.bytes||sha(archive)!==native.sha256||archive.subarray(0,5).toString()!=='PGDMP')
    throw Error('STAGE32_ARCHIVE_CHECKSUM');
  const preparation=restorePreparation(logical,native,toc.toString('utf8'));
  const expansion=await rehearseExpansion(snapshot);
  return {format:'webnovels-stage32-rehearsal-v1',checkedAt:new Date().toISOString(),
    preparation,expansion,productionApplied:false,flagsChanged:false,browserAcceptance:false,
    hostedRestoreAccepted:false,launchDecision:'NO_GO',
    pending:['HOSTED_NATIVE_AUTH_STORAGE_ROLE_ACCEPTANCE','REVIEWED_PUBLICATION_SCOPE_AND_MIGRATIONS',
      'CLOUDFLARE_IMAGES_AND_PRIVATE_STORAGE_ACCEPTANCE','CLOUDFLARE_SCHEDULED_WORKER_ACCEPTANCE']};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2||args.some(a=>a.startsWith('--')))throw Error('STAGE32_BACKUP_DIRECTORIES_REQUIRED');
  const report=await prepareStage32(...args),env=access.loadEnv();
  if(access.connection(env).ref!==report.preparation.sourceProjectRef)throw Error('STAGE32_ENV_SOURCE_MISMATCH');
  report.hostedTarget=await inspectRestoreTarget({sourceRef:report.preparation.sourceProjectRef,
    targetRef:(env.SUPABASE_RESTORE_TARGET_REF||'').trim()||null,token:access.managementToken(env)});
  if(report.hostedTarget.targetRef&&report.hostedTarget.targetRef!==report.preparation.sourceProjectRef) {
    report.preparation.targetProjectRef=report.hostedTarget.targetRef;
    report.preparation.targetConfigured=true;
  }
  await writeFile('artifacts/stage32-acceptance.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(/^STAGE32_[A-Z_]+$/.test(e.message)?e.message:'STAGE32_REHEARSAL_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
