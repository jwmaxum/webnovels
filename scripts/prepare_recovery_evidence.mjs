// Offline planning only: never imports environment credentials, remote clients or apply commands.
import {readFile} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import {buildRecoveryPacket,prepareRecoveryPackage,checkRecoveryPackage,readRecoveryDecisions,
 validateRecoveryDecisions,recoveryDecisionTemplate,recoveryEvidenceSummary,rehearseRecoveryPlan,writeRecoveryRehearsal} from './lib/recovery-evidence.mjs';
export async function runRecoveryEvidence(args){
 const [action,input,packageName,decisionFile,outputName,...extra]=args;
 if(!['prepare','check','rehearse'].includes(action)||!input||!packageName||extra.length||args.some(a=>a.startsWith('--'))||
  (action!=='rehearse'&&(decisionFile||outputName))||(action==='rehearse'&&(!decisionFile||!outputName)))throw Error('RECOVERY_EVIDENCE_ARGUMENTS_REQUIRED');
 const directory=await privateBackupDirectory(input),verified=await readVerifiedSnapshot(directory),{db}=await restoreSnapshot(verified.snapshot);
 try{
  const packet=await buildRecoveryPacket(db,verified,await readFile(new URL('../database/99_seed_dev.sql',import.meta.url),'utf8'));
  if(action==='prepare')return prepareRecoveryPackage(directory,packet,packageName);
  await checkRecoveryPackage(directory,packet,packageName);
  if(action==='check')return recoveryEvidenceSummary(packet,validateRecoveryDecisions(packet,recoveryDecisionTemplate(packet)));
  const input=await readRecoveryDecisions(directory,decisionFile),validated=validateRecoveryDecisions(packet,input);
  if(!validated.selected.length)return recoveryEvidenceSummary(packet,validated);
  const result=await rehearseRecoveryPlan(db,verified,packet,input,directory);await writeRecoveryRehearsal(directory,outputName,result);return result.report;
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 runRecoveryEvidence(process.argv.slice(2)).then(report=>{console.log(JSON.stringify(report,null,2));if(report.status!=='EVIDENCE_VALIDATED_PLAN_ONLY')process.exitCode=2;})
 .catch(e=>{console.error(/^RECOVERY_EVIDENCE_[A-Z_]+$/.test(e.message)?e.message:'RECOVERY_EVIDENCE_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
