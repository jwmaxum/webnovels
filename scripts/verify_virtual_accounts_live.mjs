// Real Supabase password login, optional deployed application checks. Tokens stay in memory.
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import access from './lib/launch-access.cjs';
import {createSecureApi} from '../server/secure-api.mjs';
async function main(){
 const env=access.loadEnv(),{url}=access.connection(env),password=env.VIRTUAL_ACCOUNT_PASSWORD;
 if(!password)throw Error('VIRTUAL_ACCOUNT_PASSWORD_REQUIRED');
 const records=JSON.parse(fs.readFileSync('scratch/launch/virtual-account-provisioning-private.json')).accounts;
 const appOrigin=env.VERIFY_APP_ORIGIN;
 if(appOrigin&&!/^https:\/\/[a-z0-9.-]+$/.test(appOrigin))throw Error('INVALID_APP_ORIGIN');
 const key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY;
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const handler=createSecureApi(),results=[];
 for(const p of records){
   const login=await client.auth.signInWithPassword({email:p.email,password});
   if(login.error||login.data?.user?.id!==p.authUserId){results.push({kind:p.kind,profileId:p.profileId,auth:false,code:login.error?.code||'IDENTITY_MISMATCH'});continue;}
   const request=new Request((appOrigin||'https://verification.invalid')+'/api/v2/me',{headers:{Authorization:'Bearer '+login.data.session.access_token}});
   const response=appOrigin?await fetch(request,{redirect:'error',signal:AbortSignal.timeout(20000)}):await handler(request,{...env,P0_API_ENABLED:'false'});
   const actor=await response.json();
   const result={kind:p.kind,profileId:p.profileId,auth:true,appStatus:response.status,
     correctProfile:response.ok&&actor.userId===p.authUserId&&String(actor[p.kind]?.id)===p.profileId&&actor.admin===null,
     ...(response.ok?{}:{error:actor.error})};
   if(p.kind==='author'&&p.profileId==='1'){
     const denied=new Request((appOrigin||'https://verification.invalid')+'/api/v2/admin/virtual-accounts',{headers:{Authorization:'Bearer '+login.data.session.access_token}});
     const noAdmin=appOrigin?await fetch(denied,{redirect:'error',signal:AbortSignal.timeout(20000)}):await handler(denied,{...env,P0_API_ENABLED:'false'});
     result.adminAccessDenied=noAdmin.status===403;
   }
   results.push(result);
   // Revoke only this verifier's session, never the user's other sessions.
   await client.auth.signOut({scope:'local'});
 }
 const report={checkedAt:new Date().toISOString(),environment:appOrigin||'local handler with real Supabase Auth and DB',
   total:records.length,authSucceeded:results.filter(x=>x.auth).length,appSucceeded:results.filter(x=>x.correctProfile).length,
   authorAdminDenied:results.find(x=>x.adminAccessDenied!==undefined)?.adminAccessDenied===true,results};
 fs.writeFileSync('artifacts/virtual-account-login'+(appOrigin?'-production':'-integration')+'.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,results:results.filter(x=>!x.auth||!x.correctProfile)},null,2));
 if(report.authSucceeded!==records.length||report.appSucceeded!==records.length||!report.authorAdminDenied)process.exitCode=1;
}
main().catch(()=>{console.error('LIVE_ACCOUNT_VERIFICATION_FAILED');process.exitCode=1;});
