// Local configuration and optional isolated-target metadata only; never sends mail or moves money.
import {mkdir,writeFile} from 'node:fs/promises';
import access from './lib/launch-access.cjs';
import {inspectRestoreTarget} from './lib/restore-target.mjs';
import {operationReadiness} from '../server/live-commerce-operations.mjs';
import {liveCommercePolicy,depositInstructions} from '../server/live-commerce-policy.mjs';
import {configureAuth} from './configure_stage35_auth.mjs';
try{
 const env=access.loadEnv();let sourceRef=null;try{sourceRef=access.connection(env).ref;}catch{}
 const target=await inspectRestoreTarget({sourceRef,targetRef:env.SUPABASE_RESTORE_TARGET_REF?.trim()||null,token:env.SUPABASE_ACCESS_TOKEN});
 let auth={status:'NOT_CHECKED'};
 try{const r=await configureAuth({env});auth={status:'READ_ONLY_CHECKED',siteHostname:r.siteHostname,publicRedirectsReady:r.publicRedirectsReady,smtpConfigured:r.smtpReady,deliveryVerified:false};}catch{auth={status:'CONFIGURATION_NOT_VERIFIED',deliveryVerified:false};}
 const report={stage:'OP-14',checkedAt:new Date().toISOString(),configuration:operationReadiness(env),financialProofPolicyConfigured:(await liveCommercePolicy(env)).enabled,bankInstructionsConfigured:!!await depositInstructions(env),
  restore:{status:target.status,blockers:target.blockers,emptyTargetVerified:target.emptyTargetVerified,restoreExecuted:false,hostedRestoreAccepted:false},auth,productionChanged:false,realMoneyMovement:false,liveReady:false};
 await mkdir('scratch/op14',{recursive:true});await writeFile('scratch/op14/readiness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('OP14_READINESS_INSPECTION_FAILED');process.exitCode=1;}
