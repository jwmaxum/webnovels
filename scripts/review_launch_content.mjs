// Operator preparation/rehearsal only. No remote write or feature-flag activation.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {safeBundleFile} from './lib/recovery-bundle.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,buildContentPacket,decisionTemplate,validateContentDecisions,
  verifyReviewEvidence,reviewSummary,contentSelectionSql,sha} from './lib/launch-content-review.mjs';
const q=s=>'"'+s.replaceAll('"','""')+'"';

export async function rehearseSelections(db,snapshot,packet,validated,template) {
  const selection=contentSelectionSql(packet,validated,template);
  for(const role of ['anon','authenticated','service_role']){
    if(!(await db.query('select 1 from pg_roles where rolname=$1',[role])).rows.length)await db.exec('create role '+role);
  }
  await db.exec(selection.sql);
  const selected=new Set(validated.selected.map(s=>s.row.episodeId));
  let preservedRows=0;
  for(const table of snapshot.tables){
    const name=q(table.schema)+'.'+q(table.name);
    const target=table.schema==='public'&&['episodes','episode_contents'].includes(table.name);
    // Cast IDs before JS sees them; unrelated numeric/string values remain the original JSON text.
    const rows=(await db.query(`select to_jsonb(r)::text row${target?', '+(table.name==='episodes'?'id':'episode_id')+'::text id':''} from ${name} r`)).rows;
    const actual=rows.filter(r=>!target||!selected.has(r.id)).map(r=>r.row).sort();
    const expected=target?(await db.query(`select value::text row,value->>'${table.name==='episodes'?'id':'episode_id'}' id from jsonb_array_elements($1::jsonb)`,
      ['['+table.rows.join(',')+']'])).rows.filter(r=>!selected.has(r.id)).map(r=>r.row).sort():[...table.rows].sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('CONTENT_REVIEW_UNEXPECTED_ROW_CHANGE');
    preservedRows+=actual.length;
  }
  const archived=(await db.query('select count(*)::int n from launch_recovery.content_selection_history where batch_id=$1',[selection.batchId])).rows[0].n;
  if(archived!==selected.size)throw Error('CONTENT_REVIEW_ARCHIVE_COUNT');
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);
    let denied=false;try{await db.query('select * from launch_recovery.content_selection_history')}catch(e){denied=e.code==='42501'}
    await db.exec('reset role');if(!denied)throw Error('CONTENT_REVIEW_ARCHIVE_EXPOSED');
  }
  let immutable=false;try{await db.exec('delete from launch_recovery.content_selection_history')}catch{immutable=true}
  if(!immutable)throw Error('CONTENT_REVIEW_MUTABLE_ARCHIVE');
  let replayRejected=false;try{await db.exec(selection.sql)}catch{replayRejected=true;await db.exec('rollback')}
  if(!replayRejected)throw Error('CONTENT_REVIEW_REPLAY_ACCEPTED');
  return {...selection,report:{...reviewSummary(packet,validated),sqlSha256:sha(selection.sql),batchId:selection.batchId,
    actualSnapshotRowsInIsolatedPGlite:true,preservedRows,privateImmutableArchive:true,replayRejected:true,
    fullSchemaRestore:false,hostedRestoreAccepted:false,productionChanged:false}};
}
async function main(){
  const [action,input,reviewFile]=process.argv.slice(2);
  if(!['prepare','rehearse'].includes(action)||!input||process.argv.includes('--apply'))throw Error('CONTENT_REVIEW_PREPARE_OR_REHEARSE_REQUIRED');
  const directory=await privateBackupDirectory(input),verified=await readVerifiedSnapshot(directory);
  const {db}=await restoreSnapshot(verified.snapshot);
  try{
    const seed=await readFile('database/99_seed_dev.sql','utf8');
    const packet=await buildContentPacket(db,verified,seed),defaultReview=decisionTemplate(packet);
    const reviewDirectory=path.join(directory,'review-stage23');
    if(action==='prepare'){
      await mkdir(reviewDirectory,{recursive:true});await privateBackupDirectory(reviewDirectory);
      await writeFile(path.join(reviewDirectory,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
      await writeFile(path.join(reviewDirectory,'decisions-template.json'),JSON.stringify(defaultReview,null,2)+'\n',{flag:'wx',mode:0o600});
      const report=reviewSummary(packet,validateContentDecisions(packet,defaultReview));
      await writeFile('artifacts/stage23-content-review.json',JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({...report,privateReviewDirectory:reviewDirectory},null,2));return;
    }
    if(!reviewFile)throw Error('CONTENT_REVIEW_DECISION_FILE_REQUIRED');
    const file=await safeBundleFile(directory,reviewFile);
    // A file inside the validated backup root is still capped before JSON parsing.
    const {size}=await (await import('node:fs/promises')).stat(file);
    if(size>16*1024*1024)throw Error('CONTENT_REVIEW_FILE_TOO_LARGE');
    const reviewed=validateContentDecisions(packet,JSON.parse(await readFile(file,'utf8')));
    await verifyReviewEvidence(directory,reviewed);
    if(!reviewed.selected.length){console.log(JSON.stringify(reviewSummary(packet,reviewed),null,2));process.exitCode=2;return;}
    const result=await rehearseSelections(db,verified.snapshot,packet,reviewed,await readFile('database/launch/004_reviewed_content_selection.sql','utf8'));
    await mkdir(reviewDirectory,{recursive:true});await privateBackupDirectory(reviewDirectory);
    await writeFile(path.join(reviewDirectory,result.batchId+'.sql'),result.sql,{flag:'wx',mode:0o600});
    await writeFile(path.join(reviewDirectory,result.batchId+'-rehearsal.json'),JSON.stringify(result.report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(result.report,null,2));
  }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(/^CONTENT_REVIEW_[A-Z_]+$/.test(e.message)?e.message:'CONTENT_REVIEW_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
