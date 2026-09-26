// Rehearse the additive console migration on a private, verified production snapshot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function main(){
 const directory=path.resolve(process.argv[2]||'');
 if(!directory.startsWith(path.resolve('scratch/launch/backups')+path.sep))throw Error('PRIVATE_BACKUP_REQUIRED');
 const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
 if(hash(bytes)!==manifest.snapshotSha256)throw Error('BACKUP_CHECKSUM_MISMATCH');
 const curation=process.argv.includes('--curation');
 const snapshot=JSON.parse(bytes),sql=fs.readFileSync(curation?'database/launch/006_work_curation.sql':'database/launch/005_admin_console.sql','utf8');
 const profiles=snapshot.tables.find(t=>t.schema==='public'&&t.name==='admin_users').rows.map(JSON.parse);
 const admin=profiles.find(a=>a.role==='SUPER_ADMIN'&&a.is_active&&a.auth_user_id);
 if(!admin)throw Error('VERIFIED_ADMIN_REQUIRED');
 const {db}=await restoreSnapshot(snapshot);let counts={};
 try{
   await db.exec('create role anon;create role authenticated;create role service_role;');
   const needed=['launch_accounts_ready','launch_account_actor','account_audit_immutable'];
   for(const name of needed){const fn=snapshot.functions.find(f=>f.signature.split('(')[0].split('.').at(-1)===name);if(!fn)throw Error('PREREQUISITE_FUNCTION_MISSING');await db.exec(fn.definition);}
   await db.exec(sql);
   for(const [action,data] of [['dashboard',{}],['works',{}],['episodes',{}],['accounts',{kind:'author'}],['cases',{source:'CONTENT_REVIEW'}],['roles',{}],['settlements',{}],['audit',{}]]){
     const result=(await db.query('select launch_admin_console($1,$2,$3) value',[admin.auth_user_id,action,data])).rows[0].value;
     if(result.error)throw Error('REHEARSAL_READ_FAILED');counts[action]=result.total??result.works;
   }
   const roles=(await db.query("select launch_admin_console($1,'roles') value",[admin.auth_user_id])).rows[0].value;
   const target=roles.items.find(x=>x.role==='SUB_ADMIN');
   if(curation){
     const work=(await db.query("select launch_admin_console($1,'works') value",[admin.auth_user_id])).rows[0].value.items[0];
     if(!work)throw Error('REHEARSAL_WORK_REQUIRED');
     await db.exec('begin');
     const data={workId:work.id,revision:work.curation_revision,flags:{is_top_recommended:!work.is_top_recommended,is_popular_work:!!work.is_popular_work,is_new_work:!!work.is_new_work},reason:'Isolated home curation rehearsal'};
     const result=(await db.query("select launch_admin_console($1,'curation-update',$2) value",[admin.auth_user_id,data])).rows[0].value;
     if(!result.saved||!result.changed||result.work.is_top_recommended===work.is_top_recommended)throw Error('REHEARSAL_CURATION_FAILED');
     const stale=(await db.query("select launch_admin_console($1,'curation-update',$2) value",[admin.auth_user_id,data])).rows[0].value;
     if(stale.status!==409)throw Error('REHEARSAL_CONFLICT_FAILED');
     await db.exec('rollback');
   }else if(target){await db.exec('begin');const result=(await db.query("select launch_admin_console($1,'role-update',$2) value",[admin.auth_user_id,
     {adminId:target.id,revision:target.revision,permissions:['CONTENT_METADATA_READ','SETTLEMENTS_READ'],reason:'Isolated permission rehearsal'}])).rows[0].value;
     if(!result.saved)throw Error('REHEARSAL_PERMISSION_FAILED');await db.exec('rollback');}
   for(const table of snapshot.tables.filter(t=>t.schema==='public')){
     const rows=(await db.query(`select to_jsonb(x)::text row from public."${table.name.replaceAll('"','""')}" x`)).rows.map(x=>x.row);
     if(hash(rows.sort().join('\n'))!==hash([...table.rows].sort().join('\n')))throw Error('PUBLIC_DATA_CHANGED');
   }
   await db.exec('set role authenticated');await db.query("select launch_admin_console($1,'dashboard')",[admin.auth_user_id]).then(()=>{throw Error('BROWSER_RPC_EXPOSED');},e=>{if(!e.message.includes('permission denied'))throw e;});
 }finally{await db.close();}
 const report={checkedAt:new Date().toISOString(),snapshotSha256:hash(bytes),migrationSha256:hash(sql),
   localProductionDataRehearsal:true,publicDataPreserved:true,counts,productionApplied:false,browserAcceptance:false,productionRoleChangesTested:false};
 if(process.argv.includes('--apply')){
   const env=access.loadEnv(),{ref}=access.connection(env);
   const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
     headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false})});
   if(!response.ok){fs.writeFileSync('scratch/launch/admin-console-apply-error-private.json',await response.text());throw Error('DATABASE_APPLY_FAILED');}
   report.productionApplied=true;
 }
 if(curation){report.curationSaveAndConflictRehearsed=true;report.productionCurationChanged=false;}
 fs.writeFileSync(curation?'artifacts/admin-curation-rollout.json':'artifacts/admin-console-rollout.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{fs.writeFileSync('scratch/launch/admin-console-preparation-error-private.json',JSON.stringify({name:e.name,message:e.message,code:e.code,causeCode:e.cause?.code},null,2));
 console.error(/^[A-Z_]+$/.test(e.message)?e.message:'ADMIN_CONSOLE_PREPARATION_FAILED');process.exitCode=1;});
