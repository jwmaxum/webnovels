// Hosted reads only. No DB writes, configuration changes or manuscript/evidence output.
const fs=require('node:fs');
const {audit}=require('./audit_stage22_launch.cjs');
const {loadEnv,connection,managementToken}=require('./lib/launch-access.cjs');
async function main(){
 const output='artifacts/stage31-launch-readiness.json';await audit(output);
 const report=JSON.parse(fs.readFileSync(output)),env=loadEnv(),source=connection(env),target=(env.SUPABASE_RESTORE_TARGET_REF||'').trim();
 report.recoveryMigrationsMissing=['authoring-019','authoring-020'].filter(v=>!report.versions.includes(v));
 report.recoveryInputs={separateTargetConfigured:/^[a-z0-9]{20}$/.test(target)&&target!==source.ref,
  actualOriginalManuscriptAccepted:false,actualEvidenceFilesAccepted:0,hostedTargetAccepted:false};
 if(report.management.ok){
  const r=await fetch('https://api.supabase.com/v1/projects',{headers:{Authorization:'Bearer '+managementToken(env)},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('PROJECT_INVENTORY_HTTP_'+r.status);const projects=await r.json();
  report.recoveryInputs.accessibleProjects=projects.length;report.recoveryInputs.accessibleNonSourceProjects=projects.filter(p=>p.id!==source.ref).length;
  report.recoveryInputs.configuredSeparateTargetAccessible=report.recoveryInputs.separateTargetConfigured&&projects.some(p=>p.id===target);
 }
 report.blockers.push(...(report.recoveryMigrationsMissing.length?['RECOVERY_MIGRATIONS_INCOMPLETE']:[]),
  'ACTUAL_RECOVERY_ORIGINAL_AND_REVIEW_EVIDENCE_REQUIRED',...(!report.recoveryInputs.separateTargetConfigured?['SEPARATE_HOSTED_TARGET_REQUIRED']:[]));
 report.productionManuscriptsWritten=false;report.transactionCandidateAppliedToHosted=false;
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({recoveryMigrationsMissing:report.recoveryMigrationsMissing,recoveryInputs:report.recoveryInputs,decision:report.decision}));
}
main().catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'STAGE31_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;});
