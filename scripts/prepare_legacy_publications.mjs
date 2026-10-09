// Private preparation and isolated rehearsal only. No remote application path.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,sha} from './lib/launch-content-review.mjs';
import {buildLegacyImportPacket,legacyImportTemplate,validateLegacyImport,verifyLegacyImportEvidence,
  legacyImportSummary,legacyImportSql} from './lib/legacy-publication-import.mjs';
const q=s=>'"'+s.replaceAll('"','""')+'"';

export async function rehearseLegacyImport(db,snapshot,packet,validated,template) {
  const generated=legacyImportSql(packet,validated,template);
  for(const role of ['anon','authenticated','service_role'])
    if(!(await db.query('select 1 from pg_roles where rolname=$1',[role])).rows.length)await db.exec('create role '+role);
  // This flag exists only inside this isolated engine; never add it to the operator SQL.
  await db.exec("set webnovels.legacy_publication_import_verified='true'");
  try{await db.exec(generated.sql)}catch(e){await db.exec('rollback');throw e;}
  let preservedRows=0;
  for(const table of snapshot.tables){
    const name=q(table.schema)+'.'+q(table.name);
    const rows=(await db.query(`select to_jsonb(r)::text row from ${name} r`)).rows.map(r=>r.row).sort();
    const expected=[...table.rows].sort();
    const append=(table.schema==='authoring'&&['publication_versions','publication_heads'].includes(table.name))||
      (table.schema==='growth'&&table.name==='publication_activity');
    if(append){
      const wanted=new Set(expected);
      if(rows.filter(r=>wanted.has(r)).length!==expected.length||rows.length!==expected.length+validated.selected.length)
        throw Error('LEGACY_IMPORT_EXISTING_PUBLICATION_CHANGED');
    }else if(JSON.stringify(rows)!==JSON.stringify(expected))throw Object.assign(Error('LEGACY_IMPORT_SOURCE_ROWS_CHANGED'),{table:table.schema+'.'+table.name});
    preservedRows+=expected.length;
  }
  const archived=(await db.query('select count(*)::int n from launch_recovery.legacy_publication_imports where batch_id=$1',[generated.batchId])).rows[0].n;
  if(archived!==validated.selected.length)throw Error('LEGACY_IMPORT_ARCHIVE_COUNT');
  if((await db.query("select to_regclass('growth.publication_activity') present")).rows[0].present!==null){
    const baseline=(await db.query(`select count(*)::int n from launch_recovery.legacy_publication_imports h
      join growth.publication_activity a on a.version_id=h.version_id
      where h.batch_id=$1 and a.kind='BASELINE' and a.created_at=(h.after_data->'head'->>'published_at')::timestamptz`,[generated.batchId])).rows[0].n;
    if(baseline!==validated.selected.length)throw Error('LEGACY_IMPORT_GROWTH_BASELINE_MISMATCH');
  }
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);let denied=false;
    try{await db.query('select * from launch_recovery.legacy_publication_imports')}catch(e){denied=e.code==='42501'}
    finally{await db.exec('reset role')}
    if(!denied)throw Error('LEGACY_IMPORT_ARCHIVE_EXPOSED');
  }
  for(const query of ['delete from launch_recovery.legacy_publication_imports','update launch_recovery.legacy_publication_imports set evidence_ref=evidence_ref']){
    let immutable=false;try{await db.exec(query)}catch(e){immutable=/immutable/.test(e.message)}
    if(!immutable)throw Error('LEGACY_IMPORT_MUTABLE_ARCHIVE');
  }
  let replayRejected=false;try{await db.exec(generated.sql)}catch{replayRejected=true;await db.exec('rollback')}
  if(!replayRejected)throw Error('LEGACY_IMPORT_REPLAY_ACCEPTED');
  await db.exec('reset webnovels.legacy_publication_import_verified');
  return {...generated,report:{...legacyImportSummary(packet,validated),sqlSha256:sha(generated.sql),batchId:generated.batchId,
    sourceRowsInIsolatedPGlite:true,preservedRows,privateImmutableArchive:true,replayRejected:true,fullSchemaRestore:false}};
}
async function main(){
  const [action,input,reviewFile,...extra]=process.argv.slice(2);
  if(!['prepare','rehearse'].includes(action)||!input||extra.length||process.argv.includes('--apply')||(action==='prepare'&&reviewFile))
    throw Error('LEGACY_IMPORT_PREPARE_OR_REHEARSE_REQUIRED');
  const directory=await privateBackupDirectory(input),verified=await readVerifiedSnapshot(directory);
  const {db}=await restoreSnapshot(verified.snapshot);
  try{
    const packet=await buildLegacyImportPacket(db,verified,await readFile('database/99_seed_dev.sql','utf8'));
    const pending=legacyImportTemplate(packet),output=path.join(directory,'import-stage24');
    if(action==='prepare'){
      await mkdir(output,{recursive:true});await privateBackupDirectory(output);
      await writeFile(path.join(output,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
      await writeFile(path.join(output,'decisions-template.json'),JSON.stringify(pending,null,2)+'\n',{flag:'wx',mode:0o600});
      const report=legacyImportSummary(packet,validateLegacyImport(packet,pending));
      await writeFile('artifacts/stage24-legacy-import.json',JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report,null,2));return;
    }
    if(!reviewFile)throw Error('LEGACY_IMPORT_DECISION_FILE_REQUIRED');
    const file=await safeBundleFile(directory,reviewFile);
    if((await lstat(file)).size>16*1024*1024)throw Error('LEGACY_IMPORT_FILE_TOO_LARGE');
    const validated=validateLegacyImport(packet,JSON.parse(await readFile(file,'utf8')));
    await verifyLegacyImportEvidence(directory,validated);
    if(!validated.selected.length){console.log(JSON.stringify(legacyImportSummary(packet,validated),null,2));process.exitCode=2;return;}
    const result=await rehearseLegacyImport(db,verified.snapshot,packet,validated,await readFile('database/launch/005_import_verified_legacy_novels.sql','utf8'));
    await mkdir(output,{recursive:true});await privateBackupDirectory(output);
    await writeFile(path.join(output,result.batchId+'.sql'),result.sql,{flag:'wx',mode:0o600});
    await writeFile(path.join(output,result.batchId+'-rehearsal.json'),JSON.stringify(result.report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(result.report,null,2));
  }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(/^LEGACY_IMPORT_[A-Z_]+$/.test(e.message)?e.message:'LEGACY_IMPORT_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
