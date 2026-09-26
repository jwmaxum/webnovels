// Rehearse against a private production backup, then optionally apply additive SQL.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=p=>fs.readFileSync(p,'utf8');
const q=v=>'"'+v.replaceAll('"','""')+'"';
const migration=read('database/launch/009_author_dashboard.sql');
const checks=`do $check$
declare uid uuid; other_uid uuid; reader_uid uuid; aid bigint; original jsonb; saved jsonb; other_before jsonb; r jsonb; bank_revision text;
begin
 select auth_user_id,id into uid,aid from public.authors where auth_user_id is not null and status='APPROVED' order by id limit 1;
 select auth_user_id into other_uid from public.authors where auth_user_id is not null and status='APPROVED' and id<>aid order by id limit 1;
 select auth_user_id into reader_uid from public.readers where auth_user_id is not null and status='ACTIVE' order by id limit 1;
 if uid is null or other_uid is null or reader_uid is null then raise exception 'VERIFICATION_PROFILES_MISSING'; end if;
 original:=public.launch_author_dashboard(uid,'profile');other_before:=public.launch_author_dashboard(other_uid,'profile');
 if original ? 'error' or other_before ? 'error' then raise exception 'PROFILE_READ_FAILED'; end if;
 r:=public.launch_author_dashboard(uid,'home');
 if r ? 'error' or r->'counts'->>'works' is null or r->'estimatedRevenue'<>'null'::jsonb then raise exception 'HOME_FAILED'; end if;
 r:=public.launch_author_dashboard(uid,'earnings');if r ? 'error' or r->>'recordStatus'<>'UNVERIFIED_LEGACY' then raise exception 'EARNINGS_FAILED'; end if;
 if (public.launch_author_dashboard(reader_uid,'profile')->>'status')::int<>403 then raise exception 'READER_ALLOWED'; end if;
 saved:=public.launch_author_dashboard(uid,'save-profile',jsonb_build_object('version',original->'profile'->>'version','penName','Dashboard transaction check','bio','Rolled back verification'));
 if saved->'profile'->>'penName'<>'Dashboard transaction check' then raise exception 'PROFILE_SAVE_FAILED'; end if;
 if (public.launch_author_dashboard(uid,'save-profile',jsonb_build_object('version',original->'profile'->>'version','penName','Stale check','bio',''))->>'status')::int<>409 then raise exception 'STALE_PROFILE_ALLOWED'; end if;
 bank_revision:=coalesce(original->'bank'->>'revision','0');
 r:=public.launch_author_dashboard(uid,'save-bank',jsonb_build_object('revision',bank_revision,'bankName','Transaction test bank','holder','Transaction test holder','last4','0000',
   'envelope',jsonb_build_object('version',1,'keyId',repeat('a',16),'iv',repeat('A',16),'ciphertext',repeat('A',32))));
 if r->'bank'->>'maskedNumber'<>'**** 0000' or r->'bank'->>'verificationStatus'<>'PENDING' or r::text like '%ciphertext%' then raise exception 'BANK_SAVE_FAILED'; end if;
 if public.launch_author_dashboard(other_uid,'profile') is distinct from other_before then raise exception 'OTHER_AUTHOR_CHANGED'; end if;
 if has_function_privilege('authenticated','public.launch_author_dashboard(uuid,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.launch_author_dashboard(uuid,text,jsonb)','EXECUTE') then raise exception 'BROWSER_RPC_EXPOSED'; end if;
 if has_table_privilege('authenticated','launch_recovery.author_payout_details','SELECT') or has_schema_privilege('authenticated','launch_recovery','USAGE') then raise exception 'PRIVATE_BANK_EXPOSED'; end if;
end $check$;`;

async function main(){
 const directory=path.resolve(process.argv[2]||'');
 assert.ok(directory.startsWith(path.resolve('scratch/launch/backups')+path.sep));
 const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),snapshot=JSON.parse(bytes),sha=hash(bytes);
 assert.equal(sha,JSON.parse(read(path.join(directory,'manifest.json'))).snapshotSha256);
 const {db}=await restoreSnapshot(snapshot);
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;set check_function_bodies=off;');
  const names=['launch_accounts_ready','launch_account_actor','launch_author_workspace_ready','private_authoring_prerequisites','creator_works','creator_drafts','account_audit_immutable'];
  for(const name of names){
    const f=snapshot.functions.find(f=>f.signature.split('(')[0].split('.').at(-1)===name);assert.ok(f,name);
    await db.exec(f.definition);await db.exec(`revoke all on function ${f.signature} from public,anon,authenticated`);
  }
  await db.exec("set webnovels.dashboard_apply_verified='true'");
  await db.exec(migration);await db.exec(migration);
  await db.exec('begin;'+checks+'rollback;');
  // No financial, profile, manuscript or account mapping row may be modified by this additive rollout.
  for(const t of snapshot.tables){
    const rows=(await db.query(`select to_jsonb(t)::text row from ${q(t.schema)}.${q(t.name)} t`)).rows.map(x=>x.row);
    assert.equal(hash(rows.sort().join('\n')),hash([...t.rows].sort().join('\n')),'SOURCE_DATA_CHANGED:'+t.schema+'.'+t.name);
  }
 }finally{await db.close();}
 const report={checkedAt:new Date().toISOString(),backupSha256:sha,migrationSha256:hash(migration),
   actualDataLocalRehearsal:true,existingTablesPreserved:snapshot.tables.length,idempotentMigration:true,
   ownerIsolation:true,profileRevisionConflict:true,bankMasked:true,payoutsEnabled:false,productionApplied:false,browserAcceptance:false};
 if(process.argv.includes('--apply')){
  const env=access.loadEnv(),{ref}=access.connection(env);
  const send=async(sql,label)=>{
    const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false})});
    if(!r.ok){fs.writeFileSync('scratch/launch/dashboard-'+label+'-error-private.json',await r.text());throw Error('DASHBOARD_'+label.toUpperCase()+'_FAILED');}
    await r.json();
  };
  await send(migration.replace('begin;',"begin; set local webnovels.dashboard_apply_verified='true';"),'apply');
  report.productionApplied=true;
  fs.writeFileSync('artifacts/author-dashboard-rollout.json',JSON.stringify(report,null,2)+'\n');
  await send('begin; set local lock_timeout=\'5s\';'+checks+'rollback;','verify');
  report.productionTransactionVerification=true;report.verificationWritesRolledBack=true;
 }
 fs.writeFileSync('artifacts/author-dashboard-rollout.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{fs.writeFileSync('scratch/launch/dashboard-preparation-error-private.json',JSON.stringify({message:e.message,stack:e.stack},null,2));console.error('AUTHOR_DASHBOARD_PREPARATION_FAILED');process.exitCode=1;});
