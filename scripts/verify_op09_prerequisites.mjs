// Read-only external acceptance. No create/cancel/restore commands or flag writes.
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {loadEnv,connection} from './lib/launch-access.cjs';
import {inspectRestoreTarget} from './lib/restore-target.mjs';
import {probePayoutTest} from './lib/op09-payout-probe.mjs';
await mkdir('scratch/op09/inputs',{recursive:true});
const env=loadEnv();let order;
try{
 if(env.OP09_PAYOUT_RECEIPT_FILE){
  const root=await realpath('scratch/op09/inputs'),file=await realpath(resolve(env.OP09_PAYOUT_RECEIPT_FILE));
  if(!file.startsWith(root+sep)||(await stat(file)).size>8192)throw Error();order=JSON.parse(await readFile(file,'utf8'));
 }
 const payout=await probePayoutTest({env,order});let sourceRef=null;try{sourceRef=connection(env).ref;}catch{}
 const target=await inspectRestoreTarget({sourceRef,targetRef:env.SUPABASE_RESTORE_TARGET_REF?.trim()||null,token:env.SUPABASE_ACCESS_TOKEN});
 const report={stage:'OP-09',checkedAt:new Date().toISOString(),payout,restore:{status:target.status,blockers:target.blockers,emptyTargetVerified:target.emptyTargetVerified,restoreExecuted:false,hostedRestoreAccepted:false},liveReady:false};
 await writeFile('scratch/op09/prerequisites.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 // Even query+empty-target observations cannot complete hosted recovery acceptance.
 process.exitCode=2;
}catch{console.error('OP09_PREREQUISITE_INPUT_UNAVAILABLE');process.exitCode=1;}
