// Narrow, read-only by default. Never activates signup, publication, PASS or payments.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {build} from 'esbuild';
import access from './lib/launch-access.cjs';
import {client,credentials,inspectCloudflare,assertPrivateTargets,assertProject,
 TARGET_SUBDOMAIN,IMAGE_WORKER,SCHEDULER} from './lib/free-beta-cloudflare.mjs';

export const OPERATION_FLAG='BETA_OPERATIONS_ENABLED';
const CLOSED_PAGES=['FREE_BETA_ENABLED','P0_API_ENABLED','NEW_SERIALS_ENABLED','AUTH_ONBOARDING_ENABLED',
 'AUTHOR_IDENTITY_ENABLED','MONETIZATION_SANDBOX_ENABLED'];
const CLOSED_SCHEDULER=['AUTHOR_PUBLISH_ENABLED','AUTHOR_IDENTITY_ENABLED','GROWTH_SERVICE_ENABLED','GROWTH_MEASUREMENT_ENABLED'];
const SETTINGS=['compatibility_date','compatibility_flags','limits','logpush','observability','placement','tags','tail_consumers','usage_model','cache_options'];
const fail=code=>{throw Error(code);};
const safeError=error=>/^CLOUDFLARE_[A-Z0-9_]+$/.test(error?.message||'')?error.message:'CLOUDFLARE_STAGE36_OPERATION_FAILED';
const clone=value=>structuredClone(value);
const equal=(a,b)=>isDeepStrictEqual(a??null,b??null);
const plainState=value=>!value?{present:false}:{present:true,type:value.type,...(value.type==='plain_text'?{enabled:value.value==='true',disabled:value.value==='false'}:{})};
const bindings=settings=>settings?.bindings||[];
const workerValue=(settings,name)=>bindings(settings).find(b=>b.name===name);
const connection=env=>{try{return access.connection(env);}catch{fail('CLOUDFLARE_SUPABASE_TARGET_REQUIRED');}};
function schedulerSchedules(snapshot){
 const result=snapshot.workers[SCHEDULER]?.schedules;
 // Official schedules GET returns result: {schedules:[...]}; accept the historical
 // array fixture/response as well, without changing the saved raw configuration.
 const rows=Array.isArray(result)?result:result?.schedules;
 if(!Array.isArray(rows)||!rows.length||rows.some(row=>typeof row?.cron!=='string'||row.cron.trim().split(/\s+/).length!==5))
  fail('CLOUDFLARE_EXISTING_CRON_REQUIRED');
 return rows;
}

export function assertStage36Evidence(report,projectRef){
 if(report?.applied!==true||report.productionApplied!==true||report.projectRef!==projectRef||
  report.native?.nativeArchiveVerified!==true||
  ['originalRowsMatch','flagsUnchanged','sourceDriftRejected','explicitGrants'].some(key=>report.rehearsal?.[key]!==true)||
  ['originalRowsMatch','flagsUnchanged','privateTableAcl','serviceOnlyRpcs'].some(key=>report.productionState?.[key]!==true))
  fail('CLOUDFLARE_STAGE36_DATABASE_EVIDENCE_REQUIRED');
}
export function assertClosedRuntime(snapshot){
 assertProject(snapshot.project);assertPrivateTargets(snapshot);
 const production=snapshot.project.deployment_configs.production;
 for(const flag of CLOSED_PAGES){const value=production.env_vars?.[flag];
  if(value&&(value.type!=='plain_text'||value.value!=='false'))fail('CLOUDFLARE_PUBLIC_ACTIVATION_REVIEW_REQUIRED');}
 for(const [name,worker] of Object.entries(snapshot.workers)){
  if(!worker.exists||worker.subdomain?.enabled!==false||worker.subdomain?.previews_enabled!==false)
   fail('CLOUDFLARE_PRIVATE_EXISTING_WORKER_REQUIRED');
  if(name===SCHEDULER)for(const flag of CLOSED_SCHEDULER){const value=workerValue(worker.settings,flag);
   if(value&&(value.type!=='plain_text'||value.text!=='false'))fail('CLOUDFLARE_SCHEDULER_ACTIVATION_REVIEW_REQUIRED');}
 }
 schedulerSchedules(snapshot);
}
export function stage36PagesPatch(project){
 assertProject(project);
 const production=project.deployment_configs.production;
 const existing=production.env_vars?.[OPERATION_FLAG];
 if(existing&&existing.type!=='plain_text')fail('CLOUDFLARE_OPERATION_FLAG_TYPE_REQUIRED');
 // Pages PATCH merges named variables; never echo encrypted placeholders or other bindings.
 return {deployment_configs:{production:{env_vars:{[OPERATION_FLAG]:{type:'plain_text',value:'true'}},
  ...(production.wrangler_config_hash?{wrangler_config_hash:production.wrangler_config_hash}:{})}}};
}
export function schedulerUpload(code,settings){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(settings?.compatibility_date||'')||!Array.isArray(settings.bindings))fail('CLOUDFLARE_WORKER_SETTINGS_REQUIRED');
 if(new Set(settings.bindings.map(b=>b.name)).size!==settings.bindings.length||settings.bindings.some(b=>!b.name||!b.type))
  fail('CLOUDFLARE_WORKER_BINDINGS_INVALID');
 const existing=workerValue(settings,OPERATION_FLAG);
 if(existing&&existing.type!=='plain_text')fail('CLOUDFLARE_OPERATION_FLAG_TYPE_REQUIRED');
 // Preserve write-only secrets and every other binding type on Cloudflare. Plain text is
 // supplied in full because its type contains the single changed binding.
 const metadata={main_module:'worker.mjs',keep_bindings:[...new Set(settings.bindings.filter(b=>b.type!=='plain_text').map(b=>b.type))],
  bindings:[...settings.bindings.filter(b=>b.type==='plain_text'&&b.name!==OPERATION_FLAG).map(clone),
   {name:OPERATION_FLAG,type:'plain_text',text:'true'}]};
 for(const key of SETTINGS)if(Object.hasOwn(settings,key))metadata[key]=clone(settings[key]);
 if(settings.has_assets||settings.assets||settings.exports||settings.containers)fail('CLOUDFLARE_COMPLEX_WORKER_REVIEW_REQUIRED');
 const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 body.set('worker.mjs',new Blob([code],{type:'application/javascript+module'}),'worker.mjs');return body;
}
const sortedBindings=settings=>bindings(settings).map(b=>b.type==='secret_text'?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name));
export function verifyStage36Change(before,after){
 assertClosedRuntime(after);
 const expected=clone(before.project.deployment_configs);
 expected.production.env_vars={...expected.production.env_vars,[OPERATION_FLAG]:{type:'plain_text',value:'true'}};
 if(!equal(expected,after.project.deployment_configs))fail('CLOUDFLARE_UNRELATED_PAGES_CONFIGURATION_CHANGED');
 if(!equal(before.routes,after.routes)||!equal(before.workers[IMAGE_WORKER],after.workers[IMAGE_WORKER]))
  fail('CLOUDFLARE_UNRELATED_WORKER_CHANGED');
 const prior=before.workers[SCHEDULER],current=after.workers[SCHEDULER];
 for(const key of ['subdomain','domains','schedules'])if(!equal(prior[key],current[key]))fail('CLOUDFLARE_SCHEDULER_ROUTING_CHANGED');
 for(const key of SETTINGS)if(!equal(prior.settings[key],current.settings[key]))fail('CLOUDFLARE_SCHEDULER_SETTINGS_CHANGED');
 const expectedBindings=sortedBindings({bindings:[...bindings(prior.settings).filter(b=>b.name!==OPERATION_FLAG),
  {name:OPERATION_FLAG,type:'plain_text',text:'true'}]});
 if(!equal(expectedBindings,sortedBindings(current.settings)))fail('CLOUDFLARE_UNRELATED_BINDING_CHANGED');
 return true;
}
export async function scriptDigest({bytes,contentType}){
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(!/^multipart\//i.test(contentType))return hash(bytes);
 // A new MIME boundary on each GET does not mean the Worker changed. Compare the
 // complete ordered inventory of named parts; keep the raw response for rollback.
 let form;try{form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();}
 catch{fail('CLOUDFLARE_SCRIPT_BACKUP_MULTIPART_INVALID');}
 const parts=[];for(const [name,value] of form.entries())parts.push(typeof value==='string'?
  {name,filename:null,type:'text',sha256:hash(value)}:
  {name,filename:value.name,type:value.type,sha256:hash(Buffer.from(await value.arrayBuffer()))});
 if(!parts.length)fail('CLOUDFLARE_SCRIPT_BACKUP_EMPTY');
 parts.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));return hash(JSON.stringify(parts));
}
async function downloadScheduler(env,fetchImpl){
 const {token,accountId}=credentials(env);
 let response;try{response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'+SCHEDULER,
  {method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});}catch{fail('CLOUDFLARE_SCRIPT_BACKUP_UNAVAILABLE');}
 if(!response.ok)fail('CLOUDFLARE_SCRIPT_BACKUP_HTTP_'+response.status);
 const contentType=response.headers.get('content-type')||'';
 if(!/^(?:multipart\/|application\/(?:javascript|javascript\+module|octet-stream)|text\/)/i.test(contentType))fail('CLOUDFLARE_SCRIPT_BACKUP_TYPE_INVALID');
 const reader=response.body?.getReader();if(!reader)fail('CLOUDFLARE_SCRIPT_BACKUP_EMPTY');
 const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;
  length+=value.length;if(length>10000000){await reader.cancel();fail('CLOUDFLARE_SCRIPT_BACKUP_TOO_LARGE');}chunks.push(Buffer.from(value));}
 if(!length)fail('CLOUDFLARE_SCRIPT_BACKUP_EMPTY');
 const script={bytes:Buffer.concat(chunks),contentType,etag:response.headers.get('etag')||null};
 return {...script,digest:await scriptDigest(script)};
}
export async function databaseReady(env,fetchImpl=fetch){
 const {ref}=connection(env),token=access.managementToken(env);
 const query="select (exists(select 1 from authoring.migrations where version='authoring-026') and exists(select 1 from authoring.migrations where version='authoring-027') and to_regprocedure('public.record_beta_operation(uuid,text,integer,integer)') is not null and to_regprocedure('public.maintain_beta_operations()') is not null and to_regprocedure('public.beta_operations_dashboard(uuid)') is not null and to_regprocedure('public.beta_support(uuid,boolean,text,jsonb)') is not null) as ready";
 let response;try{response=await fetchImpl('https://api.supabase.com/v1/projects/'+ref+'/database/query/read-only',
  {method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});}catch{fail('CLOUDFLARE_DATABASE_READINESS_UNAVAILABLE');}
 if(!response.ok)fail('CLOUDFLARE_DATABASE_READINESS_UNAVAILABLE');
 let rows;try{rows=await response.json();}catch{fail('CLOUDFLARE_DATABASE_READINESS_UNAVAILABLE');}
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.ready!==true)fail('CLOUDFLARE_DATABASE_NOT_READY');return true;
}
const privateJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
function safeBackup(root){
 const realRoot=fs.realpathSync(root),directory=path.join(realRoot,'scratch','launch','cloudflare-stage36');
 fs.mkdirSync(directory,{recursive:true});const real=fs.realpathSync(directory),relative=path.relative(realRoot,real);
 if(relative.startsWith('..')||path.isAbsolute(relative))fail('CLOUDFLARE_BACKUP_PATH_FORBIDDEN');
 return fs.mkdtempSync(path.join(real,'run-'));
}
export async function configure({argv=process.argv.slice(2),env=access.loadEnv(),fetchImpl=fetch,workspaceRoot=process.cwd()}={}){
 if(argv.some(arg=>arg!=='--apply')||argv.length>1)fail('CLOUDFLARE_INVALID_ARGUMENTS');
 const apply=argv.includes('--apply'),api=client(env,fetchImpl),before=await inspectCloudflare(api);
 assertClosedRuntime(before);const target=connection(env),projectRef=target.ref;
 const production=before.project.deployment_configs.production,scheduler=before.workers[SCHEDULER];
 for(const key of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL'])if(production.env_vars?.[key]?.value&&
  production.env_vars[key].value.replace(/\/$/,'')!==target.url)fail('CLOUDFLARE_DATABASE_TARGET_MISMATCH');
 const workerUrl=workerValue(scheduler.settings,'SUPABASE_URL');
 if(workerUrl?.type!=='plain_text'||workerUrl.text.replace(/\/$/,'')!==target.url)fail('CLOUDFLARE_DATABASE_TARGET_MISMATCH');
 const report={checkedAt:new Date().toISOString(),project:before.project.name,publicOrigin:'https://'+TARGET_SUBDOMAIN,
  projectRef,applied:false,publicActivation:false,steps:[],changedVariables:[OPERATION_FLAG],redeploymentRequired:true,
  pagesOperationFlagBefore:plainState(production.env_vars?.[OPERATION_FLAG]),schedulerOperationFlagBefore:plainState(workerValue(scheduler.settings,OPERATION_FLAG)?
   {type:workerValue(scheduler.settings,OPERATION_FLAG).type,value:workerValue(scheduler.settings,OPERATION_FLAG).text}:null),
  closedFlagsPreserved:true,privateWorkers:true,cronCount:schedulerSchedules(before).length,
  closedPagesFlags:Object.fromEntries(CLOSED_PAGES.map(name=>[name,plainState(production.env_vars?.[name])])),
  closedSchedulerFlags:Object.fromEntries(CLOSED_SCHEDULER.map(name=>{const value=workerValue(scheduler.settings,name);
   return [name,plainState(value?{type:value.type,value:value.text}:null)];})),
  pagesSecretNames:Object.entries(production.env_vars||{}).filter(([,v])=>v.type==='secret_text').map(([name])=>name).sort(),
  schedulerSecretNames:bindings(scheduler.settings).filter(b=>b.type==='secret_text').map(b=>b.name).sort()};
 const persist=()=>{fs.mkdirSync(path.join(workspaceRoot,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(workspaceRoot,'artifacts','stage36-cloudflare.json'),JSON.stringify(report,null,2)+'\n');};
 if(!apply){persist();return report;}
 try{
  let evidence;try{evidence=JSON.parse(fs.readFileSync(path.join(workspaceRoot,'artifacts','stage36-preparation.json'),'utf8'));}
  catch{fail('CLOUDFLARE_STAGE36_DATABASE_EVIDENCE_REQUIRED');}assertStage36Evidence(evidence,projectRef);
  await databaseReady(env,fetchImpl);report.databaseReady=true;
  const priorScript=await downloadScheduler(env,fetchImpl),directory=safeBackup(workspaceRoot);
  privateJson(path.join(directory,'before.json'),before);
  fs.writeFileSync(path.join(directory,'scheduler-before.bin'),priorScript.bytes,{mode:0o600,flag:'wx'});
  privateJson(path.join(directory,'scheduler-before-metadata.json'),{contentType:priorScript.contentType,etag:priorScript.etag,
   sha256:createHash('sha256').update(priorScript.bytes).digest('hex'),canonicalSha256:priorScript.digest,bytes:priorScript.bytes.length});
  report.privateBackupDirectory=path.relative(workspaceRoot,directory).split(path.sep).join('/');persist();
  const bundled=await build({absWorkingDir:path.resolve(workspaceRoot),entryPoints:['scheduler/worker.mjs'],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
  if(bundled.outputFiles.length!==1)fail('CLOUDFLARE_BUNDLE_INVALID');
  const upload=schedulerUpload(bundled.outputFiles[0].text,scheduler.settings),patch=stage36PagesPatch(before.project);
  const current=await inspectCloudflare(api),scriptNow=await downloadScheduler(env,fetchImpl);
  if(!equal(current,before)||priorScript.digest!==scriptNow.digest)fail('CLOUDFLARE_CONFIGURATION_CHANGED');
  const step=label=>{report.steps.push(label);persist();};
  await api.request('/accounts/'+api.accountId+'/workers/scripts/'+SCHEDULER,{method:'PUT',body:upload});step('scheduler:operations-configured');
  await api.request('/accounts/'+api.accountId+'/pages/projects/'+encodeURIComponent(before.project.name),{method:'PATCH',body:patch});step('pages:operations-configured');
  const after=await inspectCloudflare(api);privateJson(path.join(directory,'after.json'),after);verifyStage36Change(before,after);
  report.operationFlagsAfter={pages:after.project.deployment_configs.production.env_vars[OPERATION_FLAG].value==='true',
   scheduler:workerValue(after.workers[SCHEDULER].settings,OPERATION_FLAG).text==='true'};
  report.applied=true;report.verifiedAt=new Date().toISOString();persist();return report;
 }catch(error){report.failed=true;report.error=safeError(error);persist();throw Error(report.error);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 configure().then(report=>console.log(JSON.stringify(report))).catch(error=>{console.error(safeError(error));process.exitCode=1;});
