// Real-project read-only audit. Writes aggregates only; never prints provider error bodies.
const fs = require('node:fs');
const {loadEnv,connection,managementToken,managementProbe}=require('./lib/launch-access.cjs');
async function main(){
 const env=loadEnv(),probe=await managementProbe(env);
 const report={checkedAt:new Date().toISOString(),management:probe,databaseChecksPassed:false,runtimeAcceptance:'not_assessed',restoreAcceptance:'not_assessed',blockers:[]};
 // Local evidence never substitutes for hosted restore acceptance.
 if(fs.existsSync('artifacts/launch-native-backup.json')){
  const manual=JSON.parse(fs.readFileSync('artifacts/launch-native-backup.json','utf8'));
  report.manualBackupEvidence={createdAt:manual.createdAt,projectRef:manual.projectRef,sha256:manual.sha256,
   tableDataEntries:manual.tableDataEntries,archiveReadable:manual.archiveReadable,hostedRestoreVerified:manual.hostedRestoreVerified,
   evidenceFile:'artifacts/launch-native-backup.json',archiveRecheckedByThisAudit:false};
 }
 if(probe.ok){
  const {ref}=connection(env),headers={Authorization:'Bearer '+managementToken(env),'Content-Type':'application/json'};
  const query=async(name,sql)=>{
   const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,{method:'POST',headers,body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(20000),redirect:'error'});
   if(!r.ok)throw Error(name+'_HTTP_'+r.status);
   return r.json();
  };
  report.integrity=(await query('INTEGRITY',fs.readFileSync('database/authoring/000_integrity_audit.sql','utf8')))[0].integrity_audit;
  report.database=(await query('READINESS',fs.readFileSync('database/p0/000_launch_readiness.sql','utf8')))[0].readiness;
  if(report.database.p0_marker)report.securityVersions=await query('P0','select version,phase from public.p0_migration_status');
  if(report.database.authoring_marker)report.authoringVersions=await query('AUTHORING','select version from authoring.migrations order by version');
  const b=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/backups`,{headers,signal:AbortSignal.timeout(20000),redirect:'error'});
  report.providerBackups={status:b.status};
  if(b.ok){const data=await b.json();report.providerBackups.count=Array.isArray(data.backups)?data.backups.length:null;report.providerBackups.pitrEnabled=data.pitr_enabled===true;report.providerBackups.physicalRecoveryPointAvailable=Number(data.physical_backup_data?.latest_physical_backup_date_unix)>0;}
  const add=(condition,code)=>{if(condition)report.blockers.push(code);};
  add(report.integrity.orphan_works>0,'WORK_OWNER_UNRESOLVED');
  add(report.integrity.orphan_episodes>0||report.integrity.invalid_episode_numbers>0||report.integrity.duplicate_episode_number_groups>0,'EPISODE_INTEGRITY_UNRESOLVED');
  add(report.database.auth_users===0||!report.database.linked_authors||!report.database.linked_readers||!report.database.linked_admins,'VERIFIED_AUTH_LINKS_REQUIRED');
  add(!report.authoringVersions?.some(v=>v.version==='authoring-011'),'AUTHORING_MIGRATIONS_INCOMPLETE');
  add(!report.securityVersions?.some(v=>v.version==='p0-20260921'&&v.phase==='locked'),'P0_NOT_LOCKED');
  add((report.database.sensitive_column_access||[]).some(g=>g.can_select)||report.database.browser_writable_tables>0,'LEGACY_BROWSER_PRIVILEGES_OPEN');
  add(report.database.legacy_draft_owner_conflicts>0,'LEGACY_DRAFT_OWNER_CONFLICT');
  add(report.database.legacy_body_conflicts>0,'LEGACY_BODY_SOURCE_CONFLICT');
  add(!report.providerBackups.count&&!report.providerBackups.pitrEnabled&&!report.providerBackups.physicalRecoveryPointAvailable,'PROVIDER_BACKUP_UNAVAILABLE');
 }else report.blockers.push(probe.code);
 // A successful database audit cannot attest to restore/browser acceptance or Pages bindings.
 report.databaseChecksPassed=report.blockers.length===0;
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/launch-readiness-audit.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({checkedAt:report.checkedAt,management:probe,integrity:report.integrity,database:report.database,providerBackups:report.providerBackups,manualBackupEvidence:report.manualBackupEvidence,databaseChecksPassed:report.databaseChecksPassed,runtimeAcceptance:report.runtimeAcceptance,restoreAcceptance:report.restoreAcceptance,blockers:report.blockers},null,2));
 process.exitCode=report.databaseChecksPassed?0:2;
}
main().catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'LAUNCH_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;});
