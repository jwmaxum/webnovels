import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {restoreSnapshot} from './verify_launch_backup.mjs';
import access from './lib/launch-access.cjs';
const hash=(v,algorithm='sha256')=>crypto.createHash(algorithm).update(v).digest('hex');
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
async function main(){
 const directory=path.resolve(process.argv[2]||'');
 if(!directory.startsWith(path.resolve('scratch/launch/backups')+path.sep))throw Error('PRIVATE_BACKUP_REQUIRED');
 const bytes=fs.readFileSync(path.join(directory,'snapshot.json')),snapshot=JSON.parse(bytes),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
 if(hash(bytes)!==manifest.snapshotSha256)throw Error('BACKUP_CHECKSUM_MISMATCH');
 const provision=JSON.parse(fs.readFileSync('scratch/launch/virtual-account-provisioning-private.json'));
 const rows=(schema,table)=>snapshot.tables.find(t=>t.schema===schema&&t.name===table).rows.map(raw=>({row:JSON.parse(raw),rowHash:hash(raw,'md5')}));
 const auth=rows('auth','users').map(x=>x.row),env=access.loadEnv();
 const adminEmail=env.LAUNCH_ADMIN_EMAIL?.trim().toLowerCase();if(!adminEmail)throw Error('ADMIN_EMAIL_REQUIRED');
 const adminUsers=auth.filter(a=>a.email?.toLowerCase()===adminEmail&&a.email_confirmed_at&&!a.deleted_at&&!a.is_anonymous&&(!a.banned_until||Date.parse(a.banned_until)<=Date.now()));
 const admins=rows('public','admin_users').filter(x=>x.row.email?.toLowerCase()===adminEmail&&x.row.role==='SUPER_ADMIN'&&x.row.is_active);
 if(adminUsers.length!==1||admins.length!==1)throw Error('VERIFIED_EXISTING_ADMIN_REQUIRED');
 const plan=[];
 for(const p of provision.accounts){
   if(!['author','reader'].includes(p.kind)||!new RegExp('^'+(p.kind==='author'?'writer([1-9]|[12][0-9]|30)':'reader([1-9]|10)')+'@webnovels\\.com$').test(p.email))throw Error('VIRTUAL_SCOPE_CONFLICT');
   const profile=rows('public',p.kind==='author'?'authors':'readers').find(x=>String(x.row.id)===p.profileId&&x.row.email===p.email&&x.row.username===p.username);
   const a=auth.find(a=>a.id===p.authUserId&&a.email===p.email&&a.email_confirmed_at&&!a.deleted_at&&!a.is_anonymous&&(!a.banned_until||Date.parse(a.banned_until)<=Date.now()));
   if(!profile||!a||profile.row.auth_user_id)throw Error('PROFILE_OR_IDENTITY_CONFLICT');
   plan.push({kind:p.kind,id:p.profileId,auth:p.authUserId,email:p.email,hash:profile.rowHash});
 }
 if(plan.length!==40||plan.filter(x=>x.kind==='author').length!==30||new Set(plan.map(x=>x.auth)).size!==40)throw Error('ACCOUNT_PLAN_INCOMPLETE');
 if(admins[0].row.auth_user_id)throw Error('ADMIN_ALREADY_LINKED');
 plan.push({kind:'admin',id:admins[0].row.id,auth:adminUsers[0].id,email:adminEmail,hash:admins[0].rowHash});
 const schema=fs.readFileSync('database/launch/004_virtual_accounts.sql','utf8');
 const linking=`begin;
 set local lock_timeout='5s';
 create temp table virtual_link_plan(kind text,id text,auth_id uuid,email text,row_hash text);
 insert into virtual_link_plan values ${plan.map(p=>`(${[p.kind,p.id,p.auth,p.email,p.hash].map(lit).join(',')})`).join(',\n')};
 do $$ declare p record; table_name text; actual_hash text; begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'Database operator required'; end if;
 lock table public.authors,public.readers,public.admin_users in share row exclusive mode;
 for p in select * from virtual_link_plan loop
   table_name:=case p.kind when 'author' then 'authors' when 'reader' then 'readers' when 'admin' then 'admin_users' end;
   execute format('select md5(to_jsonb(x)::text) from public.%I x where id::text=$1 and auth_user_id is null',table_name) into actual_hash using p.id;
   if actual_hash is distinct from p.row_hash then raise exception 'Profile changed since backup'; end if;
   if not exists(select 1 from auth.users where id=p.auth_id and lower(email)=p.email and email_confirmed_at is not null and not is_anonymous
      and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'Auth identity changed'; end if;
   execute format('update public.%I set auth_user_id=$1 where id::text=$2',table_name) using p.auth_id,p.id;
   insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256)
     values(p.kind,p.id,p.auth_id,'Explicit owner request 2026-09-25: provision listed virtual writers/readers and link the newly created administrator','Codex operator executing user-approved SQL',${lit(manifest.snapshotSha256)});
   if p.kind<>'admin' then insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values(p.kind,p.id,p.auth_id,p.email); end if;
 end loop;
 if (select count(*) from launch_recovery.virtual_accounts)<>40 then raise exception 'Virtual account count mismatch'; end if;
 update launch_recovery.account_service set enabled=true,activated_at=now() where version='accounts-20260925';
 if not public.launch_accounts_ready() then raise exception 'Account security permissions are not ready'; end if;
 end $$;
 notify pgrst,'reload schema';
 commit;`;
 const {db}=await restoreSnapshot(snapshot);
 let report;
 try{
   await db.exec('create role anon;create role authenticated;create role service_role;');
   await db.exec(schema);await db.exec(linking);
   for(const p of plan){const who=(await db.query('select launch_account_actor($1) actor',[p.auth])).rows[0].actor;
     if(who.error||who[p.kind]?.id!==p.id)throw Error('REHEARSAL_IDENTITY_MISMATCH');}
   const list=(await db.query("select manage_virtual_account($1,'list','{}') result",[adminUsers[0].id])).rows[0].result;
   if(list.accounts.length!==40)throw Error('REHEARSAL_LIST_MISMATCH');
   const first=plan.find(p=>p.kind==='author');
   const update=(await db.query("select manage_virtual_account($1,'update',$2) result",[adminUsers[0].id,{kind:'author',id:first.id,revision:'1',reason:'Isolated production-data rehearsal',displayName:'리허설 작가',bio:'Rehearsal only'}])).rows[0].result;
   if(update.account?.revision!=='2')throw Error('REHEARSAL_UPDATE_FAILED');
   const deletion=(await db.query("select manage_virtual_account($1,'delete',$2) result",[adminUsers[0].id,{kind:'author',id:first.id,revision:'2',reason:'Isolated deletion rehearsal'}])).rows[0].result;
   if(!deletion.account?.deletedAt)throw Error('REHEARSAL_DELETE_FAILED');
   report={checkedAt:new Date().toISOString(),backupSha256:manifest.snapshotSha256,schemaSha256:hash(schema),linkingSha256:hash(linking),virtualAuthors:30,virtualReaders:10,administrator:1,localRealDataRehearsal:true,productionApplied:false};
 }finally{await db.close();}
 fs.writeFileSync('scratch/launch/virtual-account-linking.sql',linking);
 fs.writeFileSync('scratch/launch/virtual-account-rehearsal.json',JSON.stringify(report,null,2));
 if(process.argv.includes('--apply')){
   const {ref}=access.connection(env);
   for(const [name,sql] of [['schema',schema],['linking',linking]]){
     const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
       headers:{Authorization:'Bearer '+access.managementToken(env),'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:false})});
     if(!r.ok){fs.writeFileSync('scratch/launch/virtual-account-apply-error-private.json',await r.text());throw Error('DATABASE_APPLY_FAILED_'+name+'_'+r.status);}
   }
   report.productionApplied=true;report.appliedAt=new Date().toISOString();
 }
 fs.writeFileSync('artifacts/virtual-account-provisioning.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'ACCOUNT_LINKING_FAILED');process.exitCode=1;});
