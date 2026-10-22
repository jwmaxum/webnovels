// Defaults to read-only inspection. No credentials, provider values or raw API errors are printed.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';import access from './lib/launch-access.cjs';
import {TARGET_SUBDOMAIN,IMAGE_WORKER,SCHEDULER,FREE_FLAGS,CLOSED_FLAGS,client,inspectCloudflare,assertPrivateTargets,
 assertActivation,secretPlan,pagesPatch,deployWorker,workerBindings,fingerprint} from './lib/free-beta-cloudflare.mjs';
const fail=code=>{throw Error(code);};
const privateJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
function safeDirectory() {
 const root=fs.realpathSync(process.cwd()),directory=path.join(root,'scratch','launch','cloudflare-stage35');
 fs.mkdirSync(directory,{recursive:true});const real=fs.realpathSync(directory);
 if(path.relative(root,real).startsWith('..')||path.isAbsolute(path.relative(root,real)))fail('CLOUDFLARE_BACKUP_PATH_FORBIDDEN');return real;
}
function applicationKeys(env) {
 const supabaseUrl=access.connection(env).url,supabaseSecret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,
  publishableKey=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY;
 const role=key=>{try{return JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{return null;}};
 if(!supabaseSecret||!(supabaseSecret.startsWith('sb_secret_')||role(supabaseSecret)==='service_role')||
  !publishableKey||!(publishableKey.startsWith('sb_publishable_')||role(publishableKey)==='anon'))fail('CLOUDFLARE_SUPABASE_KEYS_REQUIRED');
 return {supabaseUrl,supabaseSecret,publishableKey};
}
async function activationReady(env,keys) {
 const report=JSON.parse(fs.readFileSync('artifacts/stage35-auth-config.json','utf8'));
 assertActivation(report,access.connection(env).ref);
 const response=await fetch(keys.supabaseUrl+'/rest/v1/rpc/new_serials_ready',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{apikey:keys.supabaseSecret,...(keys.supabaseSecret.startsWith('eyJ')?{Authorization:'Bearer '+keys.supabaseSecret}:{}),'Content-Type':'application/json'},body:'{}'});
 if(!response.ok||await response.json()!==true)fail('FREE_BETA_DATABASE_ACCEPTANCE_REQUIRED');
}
export async function configure({argv=process.argv.slice(2),env=access.loadEnv()}={}) {
 if(argv.some(a=>!['--apply','--activate'].includes(a))||new Set(argv).size!==argv.length||argv.includes('--activate')&&!argv.includes('--apply'))fail('CLOUDFLARE_INVALID_ARGUMENTS');
 const apply=argv.includes('--apply'),activate=argv.includes('--activate'),api=client(env),snapshot=await inspectCloudflare(api);
 const directory=safeDirectory(),runDirectory=path.join(directory,new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(runDirectory);privateJson(path.join(runDirectory,'before.json'),snapshot);
 const projectName=snapshot.project.name;
 const report={checkedAt:new Date().toISOString(),project:projectName,publicOrigin:'https://'+TARGET_SUBDOMAIN,accountId:api.accountId,productionBranch:'main',
  applied:false,activated:false,requestedActivation:activate,steps:[],privateBackupDirectory:runDirectory,
  workers:Object.fromEntries(Object.entries(snapshot.workers).map(([k,w])=>[k,{exists:w.exists,publicDomains:w.domains.length}])),
  publicRoutes:snapshot.routes.length,changedVariables:[...Object.keys(CLOSED_FLAGS),'PROVIDER_SETTINGS_SOURCE','PROVIDER_SETTINGS_KEY_VERSION',
   'SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY',...(activate?Object.keys(FREE_FLAGS):[])],
  smtpAcceptanceRequiredForActivation:true,redeploymentRequired:true};
 const persist=()=>{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/stage35-cloudflare.json',JSON.stringify(report,null,2)+'\n');};
 persist();if(!apply)return report;
 try {
  assertPrivateTargets(snapshot);const keys=applicationKeys(env);if(activate)await activationReady(env,keys);
  const keyFile=path.join(directory,'private-keys.json'),saved=fs.existsSync(keyFile)?JSON.parse(fs.readFileSync(keyFile,'utf8')):{};
  if(saved.accountId&&saved.accountId!==api.accountId||saved.project&&saved.project!==projectName)fail('CLOUDFLARE_LOCAL_KEY_TARGET_MISMATCH');
  const secrets=secretPlan(snapshot.project,saved.values||{});
  privateJson(keyFile,{accountId:api.accountId,project:projectName,values:secrets.values});
  const patch=pagesPatch(snapshot.project,secrets,{IMAGE_PROCESSOR:{service:IMAGE_WORKER,environment:'production'}},{...keys,activate});
  const bindings=workerBindings(secrets,{...keys,activate,priorScheduler:snapshot.workers[SCHEDULER].settings});
  const modules={};for(const [name,file] of [[IMAGE_WORKER,'image-worker/worker.mjs'],[SCHEDULER,'scheduler/worker.mjs']]) {
   const result=await build({entryPoints:[file],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
   if(result.outputFiles.length!==1)fail('CLOUDFLARE_BUNDLE_INVALID');modules[name]=result.outputFiles[0].text;
  }
  // Re-read before mutation: avoid silently overwriting configuration changed since inspection.
  const current=await inspectCloudflare(api);if(fingerprint(current)!==fingerprint(snapshot))fail('CLOUDFLARE_CONFIGURATION_CHANGED');
  const step=async label=>{report.steps.push(label);persist();};
  await deployWorker(api,IMAGE_WORKER,modules[IMAGE_WORKER],bindings.image,snapshot.workers[IMAGE_WORKER],step);
  await deployWorker(api,SCHEDULER,modules[SCHEDULER],bindings.scheduler,snapshot.workers[SCHEDULER],step);
  await api.request('/accounts/'+api.accountId+'/workers/scripts/'+SCHEDULER+'/schedules',{method:'PUT',body:[{cron:'* * * * *'}]});await step('scheduler:cron-configured');
  await api.request('/accounts/'+api.accountId+'/pages/projects/'+encodeURIComponent(projectName),{method:'PATCH',body:patch});await step('pages:production-configured');
  const after=await inspectCloudflare(api,{createdInThisRun:Object.entries(snapshot.workers).filter(([,w])=>!w.exists).map(([name])=>name)});
  privateJson(path.join(runDirectory,'after.json'),after);assertPrivateTargets(after);
  const production=after.project.deployment_configs.production;
  for(const [key,expected] of Object.entries(patch.deployment_configs.production.env_vars)) {
   const actual=production.env_vars?.[key];
   if(actual?.type!==expected.type||expected.type==='plain_text'&&actual.value!==expected.value)fail('CLOUDFLARE_CONFIG_VERIFICATION_FAILED');
  }
  for(const [key,prior] of Object.entries(snapshot.project.deployment_configs.production.env_vars||{})) {
   if(Object.hasOwn(patch.deployment_configs.production.env_vars,key))continue;
   const actual=production.env_vars?.[key];if(actual?.type!==prior.type||prior.type==='plain_text'&&actual.value!==prior.value)fail('CLOUDFLARE_UNRELATED_VARIABLE_CHANGED');
  }
  if(fingerprint(after.project.deployment_configs.preview)!==fingerprint(snapshot.project.deployment_configs.preview))fail('CLOUDFLARE_PREVIEW_CHANGED');
  if(production.services?.IMAGE_PROCESSOR?.service!==IMAGE_WORKER)fail('CLOUDFLARE_BINDING_VERIFICATION_FAILED');
  for(const worker of Object.values(after.workers))if(worker.subdomain?.enabled!==false||worker.subdomain?.previews_enabled!==false)fail('CLOUDFLARE_PRIVATE_WORKER_REQUIRED');
  report.workersBefore=report.workers;
  report.workers=Object.fromEntries(Object.entries(after.workers).map(([name,w])=>[name,{exists:w.exists,
   publicDomains:w.domains.length,workersDevEnabled:w.subdomain?.enabled,previewsEnabled:w.subdomain?.previews_enabled}]));
  report.applied=true;report.activated=activate;report.verifiedAt=new Date().toISOString();persist();return report;
 } catch(error) {
  report.failed=true;report.error=/^(?:CLOUDFLARE_|FREE_BETA_)[A-Z0-9_]+$/.test(error.message)?error.message:'CLOUDFLARE_OPERATION_FAILED';persist();throw Error(report.error);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)configure().then(r=>console.log(JSON.stringify(r))).catch(error=>{
 console.error(/^(?:CLOUDFLARE_|FREE_BETA_)[A-Z0-9_]+$/.test(error.message)?error.message:'CLOUDFLARE_OPERATION_FAILED');process.exitCode=1;
});
