// Read-only hosted checks; deliberately does not claim real-user signup or image acceptance.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const hash=rows=>createHash('sha256').update([...rows].sort().join('\n')).digest('hex');
async function main(){
 const snap=JSON.parse(fs.readFileSync(process.argv[2]+'/snapshot.json'));
 const env=access.loadEnv(),{url}=access.connection(env),secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 for(const name of ['public.admin_users','public.audit_logs','launch_recovery.admin_permission_audit','launch_recovery.account_audit']){
  const t=snap.tables.find(t=>t.schema+'.'+t.name===name),rows=await backup.query('select to_jsonb(t)::text row from '+name+' t');
  if(hash(t.rows)!==hash(rows.map(r=>r.row)))throw Error('BETA_LIVE_ADMIN_CHANGED');
 }
 const counts=(await backup.query(`select (select count(*)::int from public.admin_users) admins,
  (select count(*)::int from auth.users) auth_users,(select count(*)::int from public.authors) authors,
  (select count(*)::int from public.readers) readers,(select count(*)::int from public.works) works,
  (select count(*)::int from public.episodes) episodes,(select count(*)::int from authoring.drafts) drafts,
  (select count(*)::int from authoring.free_beta_accounts) beta_accounts,
  (select count(*)::int from storage.buckets where id in ('authoring-originals','authoring-covers','authoring-webtoons') and public=false) private_buckets`))[0];
 if(counts.admins!==4||counts.auth_users!==1||counts.authors||counts.readers||counts.works||counts.episodes||counts.drafts||counts.beta_accounts||counts.private_buckets!==3)throw Error('BETA_LIVE_COUNTS_UNEXPECTED');
 const statuses={};
 for(const rpc of ['launch_accounts_ready','launch_author_workspace_ready','launch_work_registration_ready','free_beta_enrollment_launch_ready','new_serials_ready']){
  const r=await fetch(url+'/rest/v1/rpc/'+rpc,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'},body:'{}'});
  if(!r.ok)throw Error('BETA_LIVE_RPC_HTTP_'+r.status);statuses[rpc]=await r.json();
 }
 if(Object.entries(statuses).some(([k,v])=>v!==(k!=='new_serials_ready')))throw Error('BETA_LIVE_GATE_UNEXPECTED');
 const report={checkedAt:new Date().toISOString(),adminRowsUnchanged:true,counts,statuses,
  publicActivation:false,providerCalled:false,realSignupAccepted:false,realImagesAccepted:false,browserExecuted:false};
 fs.writeFileSync('artifacts/stage35-db-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(/^BETA_|^BACKUP_/.test(e.message)?e.message:'BETA_LIVE_CHECK_FAILED');process.exitCode=1;});
