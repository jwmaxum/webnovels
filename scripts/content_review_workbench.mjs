// Private local preparation only: no remote client, SQL execution or feature flags.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {privateBackupDirectory,readVerifiedSnapshot,buildContentPacket} from './lib/launch-content-review.mjs';
import {prepareContentWorkbench,verifyContentWorkbench,stageContentEvidence,finalizeContentSession,workbenchSummary} from './lib/content-review-workbench.mjs';
export async function runWorkbench(args) {
  const [action,input,workbench,session,result]=args;
  if(!['prepare','check','stage-evidence','finalize'].includes(action)||!input||!workbench||args.length!==({prepare:3,check:3,'stage-evidence':4,finalize:5}[action]))throw Error('WORKBENCH_ARGUMENTS');
  const directory=await privateBackupDirectory(input),verified=await readVerifiedSnapshot(directory),{db}=await restoreSnapshot(verified.snapshot);
  try {
    const packet=await buildContentPacket(db,verified,await readFile('database/99_seed_dev.sql','utf8'));
    if(action==='prepare')return await prepareContentWorkbench(directory,packet,workbench);
    const checked=await verifyContentWorkbench(directory,packet,workbench);
    if(action==='check')return {...workbenchSummary(checked.model),privateFilesVerified:true};
    if(action==='stage-evidence')return {format:'webnovels-content-evidence-staged-v1',descriptor:await stageContentEvidence(directory,workbench,session),productionChanged:false};
    return await finalizeContentSession(directory,packet,workbench,session,result);
  } finally {await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  runWorkbench(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{
    const message=/^(?:WORKBENCH|CONTENT_REVIEW|RECOVERY)_[A-Z_]+$/.test(error.message)?error.message:'WORKBENCH_OPERATION_FAILED';
    console.error(message);process.exitCode=1;
  });
}
