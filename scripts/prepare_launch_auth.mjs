import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { restoreSnapshot } from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
import backup from './backup_launch_data.cjs';
const hash=(value,algorithm='sha256')=>crypto.createHash(algorithm).update(value).digest('hex');
async function main(){
  const directory=path.resolve(process.argv[2]||'');
  if(!directory.startsWith(path.resolve('scratch/launch/backups')+path.sep))throw Error('AUTH_PREP_BACKUP_REQUIRED');
  const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),snapshot=JSON.parse(bytes);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  const restore=JSON.parse(fs.readFileSync(path.join(directory,'data-restore-verification.json')));
  if(hash(bytes)!==manifest.snapshotSha256||hash(bytes)!==restore.snapshotSha256||!restore.allRowsMatch)throw Error('AUTH_PREP_BACKUP_MISMATCH');
  const fn=snapshot.functions.find(f=>f.schema==='public'&&/^(public\.)?handle_new_user\(\)$/.test(f.signature));
  const trigger=snapshot.triggers.find(t=>t.schema==='auth'&&t.table==='users'&&t.definition.includes('on_auth_user_created'));
  if(!fn||!trigger)throw Error('AUTH_PREP_EXPECTED_TRIGGER_MISSING');
  const sql=`set webnovels.legacy_auth_trigger_md5='${hash(fn.definition,'md5')}';\n`+
    fs.readFileSync('database/launch/002_prepare_auth_linking.sql','utf8');
  const sqlSha256=hash(sql),rehearsalPath=path.join(directory,'auth-preparation-rehearsal.json');
  fs.writeFileSync(path.join(directory,'prepare-auth-reviewed.sql'),sql,{mode:0o600});
  if(!process.argv.includes('--apply')){
    const {db}=await restoreSnapshot(snapshot);
    try{
      await db.exec('create role anon;create role authenticated;create role service_role');
      await db.exec('alter table auth.users alter is_sso_user set default false,alter is_anonymous set default false');
      await db.exec(fn.definition);await db.exec(trigger.definition);
      let rejected=false;try{await db.exec("insert into auth.users(id,email)values('11111111-1111-4111-8111-111111111111','local-only@example.invalid')")}
      catch(e){rejected=e.code==='42804'}if(!rejected)throw Error('AUTH_PREP_LEGACY_FAILURE_NOT_REPRODUCED');
      const before=(await db.query(`select jsonb_build_object('readers',(select jsonb_agg(to_jsonb(r)-'auth_user_id') from readers r),
        'authors',(select jsonb_agg(to_jsonb(a)-'auth_user_id') from authors a),'admins',(select jsonb_agg(to_jsonb(a)-'auth_user_id') from admin_users a)) result`)).rows[0].result;
      await db.exec(sql);
      const after=(await db.query(`select jsonb_build_object('readers',(select jsonb_agg(to_jsonb(r)-'auth_user_id') from readers r),
        'authors',(select jsonb_agg(to_jsonb(a)-'auth_user_id') from authors a),'admins',(select jsonb_agg(to_jsonb(a)-'auth_user_id') from admin_users a)) result`)).rows[0].result;
      if(JSON.stringify(before)!==JSON.stringify(after))throw Error('AUTH_PREP_PROFILE_MUTATION');
      // Local synthetic Auth insert only; never create or confirm a production account here.
      await db.exec("insert into auth.users(id,email)values('11111111-1111-4111-8111-111111111111','local-only@example.invalid')");
      const readers=(await db.query('select count(*)::int n from readers')).rows[0].n;
      if(readers!==Number(snapshot.tables.find(t=>t.schema==='public'&&t.name==='readers').row_count))throw Error('AUTH_PREP_INFERRED_PROFILE');
      await db.exec(sql); // Repeatable preparation.
      const report={verifiedAt:new Date().toISOString(),snapshotSha256:hash(bytes),sqlSha256,
        oldTriggerFailureReproduced:true,legacyProfilesPreserved:true,localAuthInsertPassed:true,
        automaticProfileCreation:false,idempotent:true,productionApplied:false,productionAuthUsersCreated:0};
      fs.writeFileSync(rehearsalPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    }finally{await db.close()}
    return;
  }
  const rehearsal=JSON.parse(fs.readFileSync(rehearsalPath));
  if(rehearsal.sqlSha256!==sqlSha256)throw Error('AUTH_PREP_REHEARSAL_REQUIRED');
  const env=access.loadEnv(),{ref}=access.connection(env);
  if(ref!==manifest.projectRef)throw Error('AUTH_PREP_PROJECT_MISMATCH');
  const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',
    headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false}),
    signal:AbortSignal.timeout(90000),redirect:'error'});
  if(!r.ok){fs.writeFileSync(path.join(directory,'auth-apply-error-private.txt'),await r.text(),{mode:0o600});throw Error('AUTH_PREP_HTTP_'+r.status)}
  const verification=(await backup.query(`select (select count(*) from auth.users)::int auth_users,
    (select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created')::int legacy_signup_triggers,
    (select count(*) from information_schema.columns where table_schema='public' and table_name in ('readers','authors','admin_users')
      and column_name='auth_user_id')::int auth_link_columns`))[0];
  const report={...rehearsal,productionApplied:true,appliedAt:new Date().toISOString(),verification};
  fs.writeFileSync(path.join(directory,'auth-preparation-applied.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync('artifacts/launch-auth-preparation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message.startsWith('AUTH_PREP_')?e.message:'AUTH_PREP_FAILED_DETAILS_WITHHELD_CHECK_BEFORE_RETRY');process.exitCode=1});
