// Read-only post-apply check. Neither enables enrollment nor runs a provider transaction.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {privateBackupDirectory,readVerifiedSnapshot} from './lib/launch-content-review.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const q=s=>'"'+s.replaceAll('"','""')+'"',lit=s=>"'"+s.replaceAll("'","''")+"'";
const md5=s=>createHash('md5').update(s).digest('hex');
try{
 const directory=await privateBackupDirectory(process.argv[2]),{snapshot,manifest,hash}=await readVerifiedSnapshot(directory);
 const env=access.loadEnv(),{url,ref}=access.connection(env);if(ref!==manifest.projectRef)throw Error('SOURCE_MISMATCH');
 const sql=snapshot.tables.map(t=>{
  const cols=snapshot.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.ordinal-b.ordinal).map(c=>q(c.name)).join(',');
  const filter=t.schema==='authoring'&&t.name==='migrations'?' where version in ('+t.rows.map(r=>lit(JSON.parse(r).version)).join(',')+')':'';
  return `select ${lit(t.schema+'.'+t.name)} name,count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(r)::text),chr(10) order by md5(to_jsonb(r)::text)),'')) hash from (select ${cols} from ${q(t.schema)}.${q(t.name)}${filter}) r`;
 }).join(' union all ');
 const rows=await backup.query(sql),mismatches=[];
 for(const t of snapshot.tables){const r=rows.find(r=>r.name===t.schema+'.'+t.name);
  if(!r||r.n!==t.rows.length||r.hash!==md5(t.rows.map(md5).sort().join('\n')))mismatches.push(t.schema+'.'+t.name);}
 const [state]=await backup.query(`select (select enabled from authoring.enrollment_settings) enrollment_enabled,
  (select count(*)::int from authoring.author_identity_attempts) identity_attempts,
  (select count(*)::int from authoring.author_identity_accounts) verified_accounts,
  (select enabled from authoring.new_serial_service) public_enabled,
  exists(select 1 from authoring.migrations where version='authoring-023') installed,
  (select count(*)::int from information_schema.role_table_grants where table_schema='authoring'
   and table_name in ('enrollment_settings','enrollment_documents','author_identity_attempts','author_rights_consents','verified_author_persons','author_identity_accounts','publication_rights_consents')
   and grantee in ('PUBLIC','anon','authenticated','service_role')) direct_grants`);
 const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw Error('SERVICE_CREDENTIAL_MISSING');
 const capabilities={};
 for(const name of ['launch_accounts_ready','launch_author_workspace_ready','launch_work_registration_ready','author_enrollment_launch_ready']){
  const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'},body:'{}'});
  capabilities[name]=r.ok&&await r.json()===true;
 }
 const verification={checkedAt:new Date().toISOString(),originalTablesChecked:rows.length,originalRowsMatch:mismatches.length===0,mismatches,state,capabilities};
 const file='artifacts/stage34-acceptance.json',old=JSON.parse(fs.readFileSync(file));
 if(old.snapshotSha256!==hash)throw Error('REPORT_BACKUP_MISMATCH');
 fs.writeFileSync(file,JSON.stringify({...old,productionApplied:state.installed,productionVerification:verification},null,2)+'\n');
 console.log(JSON.stringify(verification,null,2));
 if(mismatches.length||!state.installed||state.enrollment_enabled||state.public_enabled||state.direct_grants||Object.values(capabilities).some(v=>!v))process.exitCode=1;
}catch{console.error('STAGE34_POST_APPLY_CHECK_FAILED');process.exitCode=1;}
