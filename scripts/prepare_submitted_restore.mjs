// Offline candidate only. No environment, remote connections or production apply commands.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {buildRecoveryPacket,checkRecoveryPackage,readRecoveryDecisions,recoveryDecisionTemplate,
 validateRecoveryDecisions,recoveryEvidenceSummary} from './lib/recovery-evidence.mjs';
import {restoreTargetRef,rehearseSubmittedRestore,writeSubmittedCandidate,checkSubmittedCandidate} from './lib/submitted-recovery.mjs';

export async function runSubmittedRestore(args){
 const [action,input,packageName,decisionsFile,targetRef,outputName,...extra]=args;
 if(!['assess','rehearse','check'].includes(action)||!input||!packageName||extra.length||args.some(a=>a.startsWith('--'))||
  (action==='assess'&&(decisionsFile||targetRef||outputName))||(action!=='assess'&&(!decisionsFile||!targetRef||!outputName)))
  throw Error('SUBMITTED_RESTORE_ARGUMENTS_REQUIRED');
 const directory=await privateBackupDirectory(input),verified=await readVerifiedSnapshot(directory),{db}=await restoreSnapshot(verified.snapshot);
 try{
  const packet=await buildRecoveryPacket(db,verified,await readFile(new URL('../database/99_seed_dev.sql',import.meta.url),'utf8'));
  await checkRecoveryPackage(directory,packet,packageName);
  if(action==='assess')return recoveryEvidenceSummary(packet,validateRecoveryDecisions(packet,recoveryDecisionTemplate(packet)));
  restoreTargetRef(packet.projectRef,targetRef);
  const decisions=await readRecoveryDecisions(directory,decisionsFile),validated=validateRecoveryDecisions(packet,decisions);
  if(!validated.selected.length)return recoveryEvidenceSummary(packet,validated);
  const candidate=await rehearseSubmittedRestore(db,verified,packet,decisions,directory,targetRef);
  if(action==='check')return checkSubmittedCandidate(directory,outputName,candidate);
  await writeSubmittedCandidate(directory,outputName,candidate);return candidate.report;
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 runSubmittedRestore(process.argv.slice(2)).then(report=>{
  console.log(JSON.stringify(report,null,2));if(report.status!=='TRANSACTION_CANDIDATE_REHEARSED')process.exitCode=2;
 }).catch(e=>{console.error(/^SUBMITTED_RESTORE_[A-Z_]+$/.test(e.message)?e.message:'SUBMITTED_RESTORE_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
