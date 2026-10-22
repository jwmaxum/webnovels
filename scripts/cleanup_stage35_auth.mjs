// One-time, exact UUID inventory from the verified pre-beta backup. Never a public API.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resetInventory,clearedTables} from './lib/free-beta-reset.mjs';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const hash=rows=>createHash('sha256').update([...rows].sort().join('\n')).digest('hex');
const protectedSql=`select distinct u.id from auth.users u where
 exists(select 1 from public.admin_users a where a.auth_user_id=u.id or lower(a.email)=lower(u.email))
 or exists(select 1 from launch_recovery.account_links l where l.kind='admin' and l.auth_user_id=u.id)
 or exists(select 1 from authoring.identity_evidence i where i.profile_kind='admin' and (i.auth_user_id=u.id or i.verified_by=u.id))
 or exists(select 1 from launch_recovery.account_audit a where a.actor_id=u.id)
 or exists(select 1 from launch_recovery.admin_permission_audit a where a.actor_id=u.id)
 or exists(select 1 from authoring.retention_policy r where r.approved_by=u.id)`;
async function main(){
 const directory=await privateBackupDirectory(process.argv[2]),{snapshot,manifest,hash:sha}=await readVerifiedSnapshot(directory);
 if(process.argv.slice(3).some(x=>x!=='--apply'))throw Error('BETA_AUTH_ARGUMENT_INVALID');
 const inventory=resetInventory(snapshot),env=access.loadEnv(),{url,ref}=access.connection(env);
 if(ref!==manifest.projectRef)throw Error('BETA_AUTH_TARGET_MISMATCH');
 const applied=JSON.parse(fs.readFileSync('artifacts/stage35-preparation.json'));
 if(!applied.productionApplied||applied.snapshotSha256!==sha)throw Error('BETA_DATABASE_RESET_REQUIRED');
 const preserved=snapshot.tables.filter(t=>['public.admin_users','public.audit_logs','launch_recovery.account_audit','launch_recovery.admin_permission_audit'].includes(t.schema+'.'+t.name));
 async function verify(){
  for(const t of preserved){const current=await backup.query('select to_jsonb(t)::text row from '+t.schema+'.'+t.name+' t');
   if(hash(current.map(r=>r.row))!==hash(t.rows))throw Error('BETA_ADMIN_ROWS_CHANGED');}
  const flags=(await backup.query(`select (select enabled from authoring.new_serial_service) published,
   (select enabled from authoring.free_beta_settings) beta,(select enabled from authoring.enrollment_settings) pass`))[0];
  if(Object.values(flags).some(Boolean))throw Error('BETA_AUTH_CLEANUP_MUST_BE_CLOSED');
  const counts=await backup.query(clearedTables.map(t=>`select '${t}' name,count(*)::int n from ${t}`).join(' union all '));
  if(counts.some(t=>t.n!==0))throw Error('BETA_AUTH_CONTENT_NOT_EMPTY');
 }
 await verify();
 const protectedIds=new Set((await backup.query(protectedSql)).map(u=>u.id));
 if(inventory.retainedAuthIds.some(id=>!protectedIds.has(id)))throw Error('BETA_AUTH_ADMIN_PROOF_CHANGED');
 const existing=new Set((await backup.query('select id from auth.users')).map(u=>u.id));
 const candidates=inventory.deleteAuthIds.filter(id=>existing.has(id)&&!protectedIds.has(id));
 const report={checkedAt:new Date().toISOString(),snapshotSha256:sha,adminProfiles:inventory.adminProfiles,
  protectedAuth:protectedIds.size,candidates:candidates.length,deleted:0,applied:false};
 if(process.argv.includes('--apply')){
  const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw Error('BETA_AUTH_SERVICE_KEY_REQUIRED');
  for(const id of candidates){
   if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('BETA_AUTH_INVALID_ID');
   // Re-read admin exclusions immediately before each provider-managed deletion.
   if((await backup.query(protectedSql)).some(u=>u.id===id))throw Error('BETA_AUTH_NEW_ADMIN_LINK');
   const r=await fetch(url+'/auth/v1/admin/users/'+id,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({should_soft_delete:false})});
   if(!r.ok&&r.status!==404){fs.writeFileSync('scratch/launch/stage35-auth-error-private.txt',await r.text());throw Error('BETA_AUTH_DELETE_FAILED_HTTP_'+r.status);}
   report.deleted++;fs.writeFileSync('artifacts/stage35-auth-cleanup.json',JSON.stringify({...report,inProgress:true},null,2)+'\n');
  }
  await verify();
  const remaining=new Set((await backup.query('select id from auth.users')).map(u=>u.id));
  if([...protectedIds].some(id=>!remaining.has(id))||candidates.some(id=>remaining.has(id)))throw Error('BETA_AUTH_FINAL_STATE_MISMATCH');
  report.applied=true;report.remainingAuth=remaining.size;
 }
 fs.writeFileSync('artifacts/stage35-auth-cleanup.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(/^BETA_|^BACKUP_/.test(e.message)?e.message:'BETA_AUTH_CLEANUP_FAILED_DETAILS_PRIVATE');process.exitCode=1;});
