import {randomBytes,createHash} from 'node:crypto';
export const TARGET_SUBDOMAIN='webnovels-db4.pages.dev';
export const IMAGE_WORKER='webnovels-image-processor';
export const SCHEDULER='webnovels-authoring-scheduler';
export const FREE_FLAGS=Object.freeze(Object.fromEntries([
 'FREE_BETA_ENABLED','P0_API_ENABLED','NEW_SERIALS_ENABLED','AUTH_ONBOARDING_ENABLED',
 'AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_PUBLISH_ENABLED',
 'AUTHOR_RICH_TEXT_ENABLED','AUTHOR_PUBLICATION_REVIEW_ENABLED','AUTHOR_OPERATIONS_ENABLED',
 'AUTHOR_DISTRIBUTION_ENABLED','WEBTOON_SERVICE_ENABLED','READER_SERVICE_ENABLED',
 'READER_DISCOVERY_ENABLED','ADMIN_OPERATIONS_ENABLED','ADMIN_WORKFLOW_ENABLED'
].map(key=>[key,'true'])));
export const CLOSED_FLAGS=Object.freeze(Object.fromEntries([
 'AUTHOR_IDENTITY_ENABLED','MONETIZATION_SANDBOX_ENABLED','GROWTH_SERVICE_ENABLED',
 'GROWTH_MEASUREMENT_ENABLED','ADMIN_ROLE_CHANGES_ENABLED'
].map(key=>[key,'false'])));
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=code=>{throw Error(code);};
export function credentials(env) {
 const token=env.CLOUDFLARE_API_TOKEN?.trim(),accountId=env.CLOUDFLARE_ACCOUNT_ID?.trim();
 if(!token||!/^\S{20,256}$/.test(token))error('CLOUDFLARE_API_TOKEN_REQUIRED');
 if(!/^[a-f0-9]{32}$/i.test(accountId||''))error('CLOUDFLARE_ACCOUNT_ID_REQUIRED');
 return {token,accountId};
}
export function client(env,fetchImpl=fetch) {
 const {token,accountId}=credentials(env);
 return {accountId,async request(path,{method='GET',body,allowMissing=false}={}) {
  if(!path.startsWith('/accounts/'+accountId+'/')&&!path.startsWith('/zones?account.id='+accountId)&&!/^\/zones\/[a-f0-9]{32}\/workers\/routes$/.test(path))error('CLOUDFLARE_PATH_FORBIDDEN');
  const multipart=body instanceof FormData;
  let response;try{response=await fetchImpl('https://api.cloudflare.com/client/v4'+path,{method,redirect:'error',
   signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+token,...(body&&!multipart?{'Content-Type':'application/json'}:{})},
   ...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)})});}catch{error('CLOUDFLARE_NETWORK_UNAVAILABLE');}
  let value;try{value=await response.json();}catch{error('CLOUDFLARE_RESPONSE_INVALID');}
  if(allowMissing&&response.status===404)return null;
  if(!response.ok||value?.success!==true)error('CLOUDFLARE_HTTP_'+response.status);
  return value;
 }};
}
export function assertProject(project) {
 if(!/^[a-z0-9-]{1,63}$/.test(project?.name||'')||project.subdomain!==TARGET_SUBDOMAIN||project.production_branch!=='main'||project.source?.type!=='github'||
  project.source.config?.owner!=='jwmaxum'||project.source.config?.repo_name!=='webnovels'||
  !project.deployment_configs?.production)error('CLOUDFLARE_PROJECT_MISMATCH');
 return project;
}
export function assertActivation(report,projectRef,now=Date.now()) {
 const verified=Date.parse(report?.verifiedAt||'');
 if(report?.projectRef!==projectRef||report.applied!==true||report.configurationVerified!==true||
  report.smtpReady!==true||report.emailConfigReady!==true||report.publicRedirectsReady!==true||report.emailConfirmationRequired!==true||
  report.signupDisabled!==false||!Number.isFinite(verified)||verified>now+60000||now-verified>86400000)
  error('FREE_BETA_AUTH_ACCEPTANCE_REQUIRED');
}
export async function inspectCloudflare(api,{createdInThisRun=[]}={}) {
 const base='/accounts/'+api.accountId,candidates=[];
 for(let page=1;page<=100;page++) {
  const projects=await api.request(base+'/pages/projects?per_page=100&page='+page);
  if(!Array.isArray(projects.result))error('CLOUDFLARE_PROJECT_LIST_INVALID');
  candidates.push(...projects.result.filter(p=>p.subdomain===TARGET_SUBDOMAIN));
  if(page>=(projects.result_info?.total_pages||1))break;
  if(page===100)error('CLOUDFLARE_PROJECT_LIST_LIMIT');
 }
 if(candidates.length!==1)error('CLOUDFLARE_PROJECT_TARGET_NOT_UNIQUE');
 const selected=assertProject(candidates[0]);
 const project=assertProject((await api.request(base+'/pages/projects/'+encodeURIComponent(selected.name))).result);
 if(project.id!==selected.id||project.name!==selected.name)error('CLOUDFLARE_PROJECT_MISMATCH');
 const workers={};
 for(const name of [IMAGE_WORKER,SCHEDULER]) {
  const settings=await api.request(base+'/workers/scripts/'+name+'/settings',{allowMissing:true});
  const domains=(await api.request(base+'/workers/domains?service='+name)).result;
  if(!Array.isArray(domains))error('CLOUDFLARE_DOMAINS_INVALID');
  const subdomain=settings?(await api.request(base+'/workers/scripts/'+name+'/subdomain')).result:null;
  const schedules=settings?(await api.request(base+'/workers/scripts/'+name+'/schedules')).result:null;
  workers[name]={exists:!!settings,settings:settings?.result||null,subdomain,schedules,domains};
 }
 // Inspect only this account's routes. Never change another Worker's route.
 const routes=[];
 for(let page=1;Object.entries(workers).some(([name,w])=>w.exists&&!createdInThisRun.includes(name))&&page<=100;page++) {
  const zones=await api.request('/zones?account.id='+api.accountId+'&per_page=50&page='+page);
  if(!Array.isArray(zones.result))error('CLOUDFLARE_ZONES_INVALID');
  for(const zone of zones.result) {
   if(!/^[a-f0-9]{32}$/i.test(zone.id)||zone.account?.id!==api.accountId)error('CLOUDFLARE_ZONE_MISMATCH');
   const list=(await api.request('/zones/'+zone.id+'/workers/routes')).result;
   if(!Array.isArray(list))error('CLOUDFLARE_ROUTES_INVALID');
   for(const route of list)if([IMAGE_WORKER,SCHEDULER].includes(route.script))routes.push({zoneId:zone.id,...route});
  }
  if(page>=(zones.result_info?.total_pages||1))break;
  if(page===100)error('CLOUDFLARE_ZONES_LIMIT');
 }
 return {project,workers,routes};
}
export function assertPrivateTargets(snapshot) {
 if(snapshot.routes.length||Object.values(snapshot.workers).some(w=>w.domains.length))error('CLOUDFLARE_PUBLIC_ROUTE_REVIEW_REQUIRED');
}
const plain=value=>({type:'plain_text',value});
const secret=value=>({type:'secret_text',value});
export function secretPlan(project,saved={},generate=()=>randomBytes(32).toString('hex')) {
 const vars=project.deployment_configs.production.env_vars||{},output={},retained={};
 for(const key of ['PROVIDER_SETTINGS_MASTER_KEY','IMAGE_PROCESSOR_SHARED_SECRET']) {
  if(vars[key]) {
   if(vars[key].type!=='secret_text')error('CLOUDFLARE_SECRET_TYPE_REQUIRED');
   // The image key must also be sent to the dedicated Worker; it is write-only in Pages.
   if(key==='IMAGE_PROCESSOR_SHARED_SECRET'&&!/^[a-f0-9]{64}$/.test(saved[key]||''))error('CLOUDFLARE_IMAGE_KEY_RECOVERY_REQUIRED');
   retained[key]=true;
  } else output[key]=saved[key]||generate();
  if((output[key]||saved[key])&&!/^[a-f0-9]{64}$/.test(output[key]||saved[key]))error('CLOUDFLARE_LOCAL_KEY_INVALID');
 }
 const keyVersion=vars.PROVIDER_SETTINGS_KEY_VERSION?.value||saved.PROVIDER_SETTINGS_KEY_VERSION||'beta-v1';
 if(!/^[A-Za-z0-9_-]{1,32}$/.test(keyVersion))error('CLOUDFLARE_KEY_VERSION_INVALID');
 if(vars.PROVIDER_SETTINGS_MASTER_KEY&&!vars.PROVIDER_SETTINGS_KEY_VERSION)error('CLOUDFLARE_EXISTING_MASTER_VERSION_REQUIRED');
 return {values:{...saved,...output,PROVIDER_SETTINGS_KEY_VERSION:keyVersion},created:output,retained};
}
export function pagesPatch(project,secrets,bindings,{activate=false,supabaseUrl,supabaseSecret,publishableKey}) {
 const current=project.deployment_configs.production;
 if(current.services?.IMAGE_PROCESSOR&&current.services.IMAGE_PROCESSOR.service!==IMAGE_WORKER)error('CLOUDFLARE_IMAGE_BINDING_CONFLICT');
 for(const key of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL'])if(current.env_vars?.[key]?.value&&current.env_vars[key].value.replace(/\/$/,'')!==supabaseUrl)
  error('CLOUDFLARE_DATABASE_TARGET_MISMATCH');
 const env_vars={...Object.fromEntries(Object.entries(CLOSED_FLAGS).map(([k,v])=>[k,plain(v)])),
  PROVIDER_SETTINGS_SOURCE:plain('database'),PROVIDER_SETTINGS_KEY_VERSION:plain(secrets.values.PROVIDER_SETTINGS_KEY_VERSION),
  SUPABASE_URL:plain(supabaseUrl),NEXT_PUBLIC_SUPABASE_URL:plain(supabaseUrl),SUPABASE_SECRET_KEY:secret(supabaseSecret),
  NEXT_PUBLIC_SUPABASE_ANON_KEY:plain(publishableKey)};
 for(const [key,value] of Object.entries(secrets.created))env_vars[key]=secret(value);
 if(activate)for(const [key,value] of Object.entries(FREE_FLAGS))env_vars[key]=plain(value);
 // Same partial PATCH contract used by official Wrangler pages secret put/bulk.
 // Unmentioned encrypted variables are retained server-side, not echoed back as placeholders.
 return {deployment_configs:{production:{env_vars,services:{...(current.services||{}),...bindings},
  ...(current.wrangler_config_hash?{wrangler_config_hash:current.wrangler_config_hash}:{})}}};
}
export function uploadBody(code,bindings) {
 const body=new FormData();
 body.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-10-22',bindings})],{type:'application/json'}));
 body.set('worker.mjs',new Blob([code],{type:'application/javascript+module'}),'worker.mjs');
 return body;
}
export async function deployWorker(api,name,code,bindings,previous,onStep=()=>{}) {
 if(![IMAGE_WORKER,SCHEDULER].includes(name))error('CLOUDFLARE_WORKER_FORBIDDEN');
 const base='/accounts/'+api.accountId+'/workers/scripts/'+name;
 if(!previous.exists) {
  await api.request(base,{method:'PUT',body:uploadBody('export default {fetch(){return new Response("Not found",{status:404})},scheduled(){}};',[])});
  await onStep(name+':private-bootstrap');
 }
 await api.request(base+'/subdomain',{method:'POST',body:{enabled:false,previews_enabled:false}});
 const state=(await api.request(base+'/subdomain')).result;
 if(state.enabled!==false||state.previews_enabled!==false)error('CLOUDFLARE_PRIVATE_WORKER_REQUIRED');
 await api.request(base,{method:'PUT',body:uploadBody(code,bindings)});await onStep(name+':uploaded');
 const final=(await api.request(base+'/subdomain')).result;
 if(final.enabled!==false||final.previews_enabled!==false)error('CLOUDFLARE_PRIVATE_WORKER_REQUIRED');
}
export function workerBindings(secrets,{supabaseUrl,supabaseSecret,activate=false,priorScheduler=null}) {
 const existingPublish=priorScheduler?.bindings?.some(b=>b.name==='AUTHOR_PUBLISH_ENABLED'&&b.type==='plain_text'&&b.text==='true');
 return {
  image:[{type:'images',name:'IMAGES'},{type:'secret_text',name:'IMAGE_PROCESSOR_SHARED_SECRET',text:secrets.values.IMAGE_PROCESSOR_SHARED_SECRET}],
  scheduler:[{type:'plain_text',name:'SUPABASE_URL',text:supabaseUrl},{type:'secret_text',name:'SUPABASE_SECRET_KEY',text:supabaseSecret},
   ...Object.entries({AUTHOR_PUBLISH_ENABLED:activate||existingPublish?'true':'false',WEBTOON_SERVICE_ENABLED:'true',
    GROWTH_SERVICE_ENABLED:'false',GROWTH_MEASUREMENT_ENABLED:'false',AUTHOR_IDENTITY_ENABLED:'false'})
    .map(([name,text])=>({type:'plain_text',name,text}))]
 };
}
