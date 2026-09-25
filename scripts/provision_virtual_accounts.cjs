// Operator tool. Only explicitly requested seed accounts; never create identities by SQL.
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { loadEnv, connection } = require('./lib/launch-access.cjs');
const { query } = require('./backup_launch_data.cjs');
async function main() {
  const env=loadEnv(), {url}=connection(env), password=env.VIRTUAL_ACCOUNT_PASSWORD;
  if (!password || password.length<6) throw Error('VIRTUAL_ACCOUNT_PASSWORD_REQUIRED');
  const manifestPath='scratch/launch/virtual-account-provisioning-private.json';
  const prior=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{accounts:[]};
  const rows=await query(`select 'author' kind,id::text profile_id,username,email,auth_user_id from public.authors
    where username ~ '^writer([1-9]|[12][0-9]|30)$' and email=username||'@webnovels.com'
    union all select 'reader',id::text,username,email,auth_user_id from public.readers
    where username ~ '^reader([1-9]|10)$' and email=username||'@webnovels.com' order by kind,profile_id`);
  if(rows.filter(r=>r.kind==='author').length!==30 || rows.filter(r=>r.kind==='reader').length!==10)
    throw Error('SEED_ACCOUNT_INVENTORY_CHANGED');
  const existing=await query('select id,email,email_confirmed_at,deleted_at,banned_until from auth.users');
  const client=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const row of rows){
    const match=existing.filter(u=>u.email?.toLowerCase()===row.email);
    if(match.length>1 || (row.auth_user_id && row.auth_user_id!==match[0]?.id))throw Error('IDENTITY_CONFLICT');
    if(match[0]?.deleted_at || (match[0]?.banned_until && Date.parse(match[0].banned_until)>Date.now()))throw Error('ACCOUNT_RESTRICTED');
    let account=prior.accounts.find(x=>x.kind===row.kind&&x.profileId===row.profile_id);
    if(account){
      if(account.email!==row.email || (match[0]&&match[0].id!==account.authUserId))throw Error('PROVISIONING_CONFLICT');
      continue;
    }
    const attributes={password,email_confirm:true};
    const result=match[0]
      ? await client.auth.admin.updateUserById(match[0].id,attributes)
      : await client.auth.admin.createUser({...attributes,email:row.email,app_metadata:{virtual_account:true,provisioning_batch:'virtual-accounts-20260925'}});
    if(result.error || !result.data?.user?.id)throw Error('AUTH_PROVISION_FAILED:'+row.username+':'+(result.error?.code||'unknown'));
    account={kind:row.kind,profileId:row.profile_id,username:row.username,email:row.email,authUserId:result.data.user.id,
      action:match[0]?'updated-requested-password':'created',provisionedAt:new Date().toISOString()};
    prior.accounts.push(account);
    fs.writeFileSync(manifestPath,JSON.stringify(prior,null,2));
    console.log(JSON.stringify({account:row.username,action:account.action}));
  }
  console.log(JSON.stringify({accounts:prior.accounts.length,credentialsLogged:false}));
}
if(require.main===module)main().catch(e=>{console.error(/^(SEED_|VIRTUAL_|IDENTITY_|ACCOUNT_|PROVISIONING_|AUTH_PROVISION_FAILED:)/.test(e.message)?e.message:'PROVISIONING_FAILED');process.exitCode=1;});
