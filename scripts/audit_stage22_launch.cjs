// Read-only aggregate audit. Does not apply SQL, alter bindings, or load remote JavaScript.
const fs=require('node:fs');
const {loadEnv,connection,managementToken,managementProbe}=require('./lib/launch-access.cjs');
const required=['001','003','004','005','006','007','008','009','010','011','012','013','014','015','017','018'].map(n=>'authoring-'+n);
function assess({database={},integrity={},versions=[],security=[],runtime={},management={}}){
 const blockers=[];
 if(!management.ok)blockers.push(management.code||'DATABASE_AUDIT_UNAVAILABLE');
 const missing=required.filter(v=>!versions.includes(v));if(missing.length)blockers.push('AUTHORING_MIGRATIONS_INCOMPLETE');
 if(!security.some(v=>v.version==='p0-20260921'&&v.phase==='locked'))blockers.push('P0_NOT_LOCKED');
 if(database.legacy_body_conflicts>0)blockers.push('LEGACY_BODY_SOURCE_CONFLICT');
 if(database.legacy_draft_owner_conflicts>0)blockers.push('LEGACY_DRAFT_OWNER_CONFLICT');
 if(database.browser_writable_tables>0||(database.sensitive_column_access||[]).some(x=>x.can_select))blockers.push('LEGACY_BROWSER_PRIVILEGES_OPEN');
 if(!database.auth_users||!database.linked_authors||!database.linked_readers||!database.linked_admins)blockers.push('VERIFIED_AUTH_LINKS_REQUIRED');
 if(integrity.orphan_works>0||integrity.orphan_episodes>0||integrity.duplicate_episode_number_groups>0||integrity.invalid_episode_numbers>0)blockers.push('CONTENT_INTEGRITY_UNRESOLVED');
 if(runtime.healthStatus!==200||runtime.healthCode!=='ok')blockers.push('FREE_RUNTIME_NOT_READY');
 blockers.push('HOSTED_DB_STORAGE_RESTORE_ACCEPTANCE_REQUIRED','ROLE_DEVICE_BETA_ACCEPTANCE_REQUIRED');
 return {decision:'NO_GO',missingMigrations:missing,blockers,actualSqlAppliedByThisAudit:false,flagsChanged:false,
  actualGrowthExperimentStarted:false,hostedRestoreAccepted:false};
}
async function audit(output='artifacts/stage22-launch-readiness.json'){
 const env=loadEnv(),management=await managementProbe(env),report={checkedAt:new Date().toISOString(),kind:'HOSTED_READ_ONLY_AGGREGATES',management:{ok:management.ok,code:management.code,status:management.status},versions:[],security:[]};
 if(management.ok){
  const {ref}=connection(env),headers={Authorization:'Bearer '+managementToken(env),'Content-Type':'application/json'};
  const query=async sql=>{const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query/read-only',
   {method:'POST',headers,body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(20000),redirect:'error'});
   if(!r.ok)throw Error('AUDIT_HTTP_'+r.status);return r.json();};
  report.database=(await query(fs.readFileSync('database/p0/000_launch_readiness.sql','utf8')))[0].readiness;
  report.integrity=(await query(fs.readFileSync('database/authoring/000_integrity_audit.sql','utf8')))[0].integrity_audit;
  if(report.database.authoring_marker)report.versions=(await query('select version from authoring.migrations order by version')).map(x=>x.version);
  if(report.database.p0_marker)report.security=await query('select version,phase from public.p0_migration_status');
 }
 const origin=env.LAUNCH_PUBLIC_ORIGIN||'https://webnovels-db4.pages.dev';
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('INVALID_LAUNCH_ORIGIN');
 report.runtime={origin:url.origin,healthStatus:null,healthCode:'UNAVAILABLE'};
 try{const r=await fetch(new URL('/api/v2/health',url),{signal:AbortSignal.timeout(20000),redirect:'error'});report.runtime.healthStatus=r.status;
  const body=await r.json();const code=body.error||body.status;if(/^[A-Za-z0-9_]+$/.test(code||''))report.runtime.healthCode=code;}catch{}
 Object.assign(report,assess(report));
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({checkedAt:report.checkedAt,decision:report.decision,authUsers:report.database?.auth_users,
  linkedAuthors:report.database?.linked_authors,bodyConflicts:report.database?.legacy_body_conflicts,storageObjects:report.database?.storage_objects,
  missingMigrations:report.missingMigrations,runtime:report.runtime,blockers:report.blockers},null,2));process.exitCode=2;
}
module.exports={assess,audit};
if(require.main===module)audit().catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'STAGE22_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;});
