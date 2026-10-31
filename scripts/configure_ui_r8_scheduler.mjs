// Read-only by default. The sole permitted mutation enables existing publication
// scheduling; it never invokes schedule RPCs, replaces source, or changes Pages.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import access from './lib/launch-access.cjs';
import {client,credentials,inspectCloudflare,assertProject,assertPrivateTargets,SCHEDULER} from './lib/free-beta-cloudflare.mjs';
import {scriptDigest} from './configure_stage36_cloudflare.mjs';

export const FLAG='AUTHOR_PUBLISH_ENABLED';
const SETTINGS=['compatibility_date','compatibility_flags','limits','logpush','observability','placement','tags','tail_consumers','usage_model','cache_options','annotations'];
const READONLY=['has_modules','has_assets','exports_reconciliation'];
const fail=code=>{throw Error('UI_R8_SCHEDULER_'+code);};
const safeError=error=>/^(?:UI_R8_SCHEDULER_|CLOUDFLARE_)[A-Z0-9_]+$/.test(error?.message||'')?error.message:'UI_R8_SCHEDULER_OPERATION_FAILED';
const equal=(a,b)=>isDeepStrictEqual(a,b),clone=value=>structuredClone(value);
const binding=(settings,name)=>settings.bindings.find(item=>item.name===name);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function target(env){try{return access.connection(env);}catch{fail('DATABASE_TARGET_REQUIRED');}}
function settingsValid(settings){
 if(!settings||!Array.isArray(settings.bindings)||!/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date||''))fail('SETTINGS_REQUIRED');
 if(Object.keys(settings).some(key=>!['bindings',...SETTINGS,...READONLY].includes(key))||settings.has_assets===true)fail('COMPLEX_SETTINGS_REVIEW_REQUIRED');
 if(new Set(settings.bindings.map(item=>item.name)).size!==settings.bindings.length||settings.bindings.some(item=>!item.name||!item.type||item.type==='plain_text'&&typeof item.text!=='string'))fail('BINDINGS_AMBIGUOUS');
 const annotations=settings.annotations;
 if(annotations&&(Object.keys(annotations).some(key=>!['workers/message','workers/tag','workers/triggered_by'].includes(key))||annotations['workers/triggered_by']&&annotations['workers/triggered_by']!=='upload'))fail('ANNOTATIONS_REVIEW_REQUIRED');
 const flag=binding(settings,FLAG);if(flag?.type!=='plain_text'||!['false','true'].includes(flag.text))fail('FLAG_TYPE_REQUIRED');
}
export function assertRuntime(snapshot,connection){
 assertProject(snapshot.project);assertPrivateTargets(snapshot);
 const worker=snapshot.workers[SCHEDULER];
 if(!worker?.exists||worker.subdomain?.enabled!==false||worker.subdomain?.previews_enabled!==false||worker.domains.length)fail('PRIVATE_WORKER_REQUIRED');
 settingsValid(worker.settings);
 const schedules=Array.isArray(worker.schedules)?worker.schedules:worker.schedules?.schedules;
 if(!Array.isArray(schedules)||!schedules.length||schedules.some(item=>typeof item.cron!=='string'||item.cron.trim().split(/\s+/).length!==5))fail('EXISTING_CRON_REQUIRED');
 const production=snapshot.project.deployment_configs.production.env_vars||{},urls=['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL'].map(key=>production[key]).filter(Boolean);
 if(!urls.length||urls.some(value=>value.type!=='plain_text'||typeof value.value!=='string'||value.value.replace(/\/$/,'')!==connection.url))fail('DATABASE_TARGET_MISMATCH');
 const workerUrl=binding(worker.settings,'SUPABASE_URL');
 if(workerUrl?.type!=='plain_text'||workerUrl.text.replace(/\/$/,'')!==connection.url)fail('DATABASE_TARGET_MISMATCH');
 if(binding(worker.settings,'SUPABASE_SECRET_KEY')?.type!=='secret_text')fail('SUPABASE_SECRET_BINDING_REQUIRED');
 if(production[FLAG]?.type!=='plain_text'||production[FLAG].value!=='true')fail('PAGES_PUBLICATION_NOT_ENABLED');
 if(binding(worker.settings,'WEBTOON_SERVICE_ENABLED')?.text!=='true'||binding(worker.settings,'WEBTOON_SERVICE_ENABLED')?.type!=='plain_text')fail('WEBTOON_CONTRACT_REQUIRED');
 return worker;
}
export async function databaseState(env,fetchImpl=fetch){
 const {ref}=target(env);let token;try{token=access.managementToken(env);}catch{fail('DATABASE_READ_TOKEN_REQUIRED');}
 const definitions=["authoring.draft_json(uuid,bigint)","authoring.publication_json(uuid)","authoring.review_original_publications(uuid,text,bigint,uuid,bigint,jsonb,uuid)","public.creator_publications_v18(uuid,text,bigint,uuid,bigint,jsonb,uuid)","public.run_creator_schedules_v18(integer)"];
 const defs=definitions.map(name=>`pg_get_functiondef(to_regprocedure('${name}'))`);
 const query="select (exists(select 1 from authoring.migrations where version='authoring-028') and "+definitions.map(name=>`to_regprocedure('${name}') is not null`).join(' and ')+
  ` and position('hasPublicationHistory' in ${defs[0]})>0 and position('hasPublicationHistory' in ${defs[1]})>0 and position('list_version.work_id=w.id' in ${defs[2]})>0) as ready, `+
  "(select count(*) from authoring.schedules where status='PENDING') as pending, (select count(*) from authoring.schedules where status='RUNNING') as running, "+
  `md5(concat_ws('|',${defs.join(',')})) as contract_fingerprint`;
 let response;try{response=await fetchImpl('https://api.supabase.com/v1/projects/'+ref+'/database/query/read-only',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})});}catch{fail('DATABASE_READ_UNAVAILABLE');}
 if(!response.ok)fail('DATABASE_READ_UNAVAILABLE');let rows;try{rows=await response.json();}catch{fail('DATABASE_READ_UNAVAILABLE');}
 const row=rows?.[0];if(!Array.isArray(rows)||rows.length!==1||typeof row?.ready!=='boolean'||![row.pending,row.running].every(value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value)))||!/^[a-f0-9]{32}$/.test(row.contract_fingerprint||''))fail('DATABASE_STATE_INVALID');
 return {ready:row.ready,pending:Number(row.pending),running:Number(row.running),contractFingerprint:row.contract_fingerprint};
}
const assertDatabase=value=>{if(!value.ready)fail('DATABASE_028_REQUIRED');if(value.pending||value.running)fail('ACTIVE_QUEUE_MUST_BE_EMPTY');};
function textModuleBytes(source,name,value){
 // Native formData is authoritative for parts. Its text-part result discards
 // MIME headers, so inspect only the bounded headers/framing of this one known
 // Cloudflare module part; never implement a general multipart decoder.
 const boundary=source.contentType.match(/\bboundary=(?:"([^"\r\n]+)"|([^;\s]+))/i),token=boundary?.[1]||boundary?.[2];
 if(!token||token.length>200||!/^[\x21-\x7e]+$/.test(token)||source.entrypoint!==name||source.moduleWorker===false||
  source.moduleWorker!==undefined&&typeof source.moduleWorker!=='boolean'||!/^[A-Za-z0-9_-]+\.mjs$/.test(name))fail('SOURCE_TEXT_HEADERS_INVALID');
 const bytes=Buffer.from(source.bytes),opening=Buffer.from('--'+token+'\r\n'),separator=Buffer.from('\r\n\r\n'),closing=Buffer.from('\r\n--'+token+'--');
 const headerEnd=bytes.indexOf(separator,opening.length),end=bytes.lastIndexOf(closing);
 if(!bytes.subarray(0,opening.length).equals(opening)||headerEnd<opening.length||headerEnd-opening.length>8192||end<headerEnd+4||
  ![closing,Buffer.concat([closing,Buffer.from('\r\n')])].some(tail=>bytes.subarray(end).equals(tail)))fail('SOURCE_TEXT_HEADERS_INVALID');
 const lines=bytes.subarray(opening.length,headerEnd).toString('latin1').split('\r\n');
 if(lines.length>16||lines.some(line=>!/^[-A-Za-z]+: [\x20-\x7e]+$/.test(line)))fail('SOURCE_TEXT_HEADERS_INVALID');
 const headers=lines.map(line=>[line.slice(0,line.indexOf(':')).toLowerCase(),line.slice(line.indexOf(':')+1).trim()]);
 if(new Set(headers.map(([key])=>key)).size!==headers.length)fail('SOURCE_TEXT_HEADERS_INVALID');
 const declared=headers.find(([key])=>key==='content-type')?.[1].toLowerCase(),type=declared||'application/javascript+module',disposition=headers.find(([key])=>key==='content-disposition')?.[1];
 // Cloudflare's module download can omit Content-Type and filename. Infer a
 // JS module only for this explicit .mjs entrypoint. The settings API can omit
 // has_modules; a contradictory explicit declaration is rejected above.
 if(!['application/javascript+module','text/javascript+module'].includes(type)||disposition!==`form-data; name="${name}"`||headers.some(([key])=>!['content-type','content-disposition'].includes(key)))fail('SOURCE_TEXT_HEADERS_INVALID');
 const payload=bytes.subarray(headerEnd+4,end);
 if(!Buffer.from(value,'utf8').equals(payload))fail('SOURCE_TEXT_NOT_BYTE_PRESERVING');
 return {name,type,bytes:payload};
}
async function sourceParts(source){
 let original;try{original=await new Response(source.bytes,{headers:{'Content-Type':source.contentType}}).formData();}catch{fail('SOURCE_MULTIPART_INVALID');}
 const entries=[...original.entries()];
 if(!entries.length||new Set(entries.map(([name])=>name)).size!==entries.length||entries.some(([name])=>name==='metadata'||!name))fail('SOURCE_PARTS_AMBIGUOUS');
 if(entries.some(([,value])=>typeof value==='string')){
  if(entries.length!==1||typeof entries[0][1]!=='string')fail('SOURCE_PARTS_AMBIGUOUS');
  return [textModuleBytes(source,entries[0][0],entries[0][1])];
 }
 if(entries.some(([name,value])=>value.name!==name))fail('SOURCE_PARTS_AMBIGUOUS');
 return Promise.all(entries.map(async([name,value])=>({name,type:value.type,bytes:Buffer.from(await value.arrayBuffer())})));
}
function mainModule(source,parts){
 const modules=parts.filter(item=>/^(?:application|text)\/javascript\+module$/.test(item.type));
 const main=source.entrypoint||(modules.length===1?modules[0].name:null);
 if(!main||!modules.some(item=>item.name===main))fail('SOURCE_ENTRYPOINT_AMBIGUOUS');return main;
}
async function canonicalDigest(source){
 const parts=await sourceParts(source),entrypoint=mainModule(source,parts);
 const form=new FormData();for(const part of parts)form.set(part.name,new Blob([part.bytes],{type:part.type}),part.name);
 const response=new Response(form),partsDigest=await scriptDigest({bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')});
 return sha(Buffer.from(JSON.stringify({entrypoint,partsDigest})));
}
export async function downloadSource(env,fetchImpl=fetch,settings){
 const {token,accountId}=credentials(env);let response;
 try{response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'+SCHEDULER,{method:'GET',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+token}});}catch{fail('SOURCE_DOWNLOAD_UNAVAILABLE');}
 if(!response.ok)fail('SOURCE_DOWNLOAD_UNAVAILABLE');const contentType=response.headers.get('content-type')||'';
 if(!/^multipart\//i.test(contentType))fail('MULTIPART_SOURCE_REQUIRED');
 const reader=response.body?.getReader();if(!reader)fail('SOURCE_EMPTY');const chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>10_000_000){await reader.cancel();fail('SOURCE_TOO_LARGE');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks);if(!bytes.length)fail('SOURCE_EMPTY');
 const source={bytes,contentType,etag:response.headers.get('etag')||null,entrypoint:response.headers.get('cf-entrypoint')||null,moduleWorker:settings?.has_modules};
 return {...source,digest:await canonicalDigest(source)};
}
export async function schedulerUpload(source,settings){
 settingsValid(settings);if(binding(settings,FLAG).text!=='false')fail('ALREADY_ENABLED_REVIEW_REQUIRED');
 const parts=await sourceParts(source),main=mainModule(source,parts);
 const metadata={main_module:main,keep_bindings:[...new Set(settings.bindings.filter(item=>item.type!=='plain_text').map(item=>item.type))],
  bindings:settings.bindings.filter(item=>item.type==='plain_text').map(item=>item.name===FLAG?{...clone(item),text:'true'}:clone(item))};
 for(const key of SETTINGS)if(Object.hasOwn(settings,key)){metadata[key]=clone(settings[key]);if(key==='annotations'&&metadata[key])delete metadata[key]['workers/triggered_by'];}
 const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 for(const part of parts)body.set(part.name,new Blob([part.bytes],{type:part.type}),part.name);
 return body;
}
export function verifyChange(before,after,connection){
 assertRuntime(after,connection);
 const expected=clone(before);binding(expected.workers[SCHEDULER].settings,FLAG).text='true';
 // Binding order is not semantic; encrypted values are never present in GET.
 const normalize=snapshot=>{const copy=clone(snapshot);for(const worker of Object.values(copy.workers))if(worker.settings?.bindings)worker.settings.bindings.sort((a,b)=>a.name.localeCompare(b.name));return copy;};
 if(!equal(normalize(expected),normalize(after)))fail('UNRELATED_CONFIGURATION_CHANGED');return true;
}
function backupDirectory(workspaceRoot){
 const root=fs.realpathSync(workspaceRoot);if(!/^scratch\/\s*$/m.test(fs.readFileSync(path.join(root,'.gitignore'),'utf8')))fail('IGNORED_BACKUP_REQUIRED');
 let directory=root;
 for(const part of ['scratch','launch','ui-r8-scheduler']){directory=path.join(directory,part);if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});const real=fs.realpathSync(directory),relative=path.relative(root,real);if(relative.startsWith('..')||path.isAbsolute(relative))fail('BACKUP_PATH_FORBIDDEN');directory=real;}
 return fs.mkdtempSync(path.join(directory,'run-'));
}
const privateJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
export async function configure({argv=process.argv.slice(2),env=access.loadEnv(),fetchImpl=fetch,workspaceRoot=process.cwd()}={}){
 if(argv.length>1||argv.some(value=>value!=='--apply'))fail('INVALID_ARGUMENTS');
 const apply=argv.includes('--apply'),connection=target(env),api=client(env,fetchImpl),before=await inspectCloudflare(api),worker=assertRuntime(before,connection);
 const database=await databaseState(env,fetchImpl),source=await downloadSource(env,fetchImpl,worker.settings),enabled=binding(worker.settings,FLAG).text==='true';
 const upload=enabled?null:await schedulerUpload(source,worker.settings);
 const report={checkedAt:new Date().toISOString(),project:before.project.name,projectRef:connection.ref,worker:SCHEDULER,applied:false,
  publicationEnabled:enabled,ready:database.ready&&!database.pending&&!database.running&&!enabled,databaseReady:database.ready,pendingSchedules:database.pending,runningSchedules:database.running,
  sourceDigest:source.digest,sourceBytes:source.bytes.length,changedVariables:[FLAG],privateWorker:true,cronPreserved:true,sourcePreserved:true};
 if(!apply)return report;
 try{
  assertDatabase(database);if(enabled)fail('ALREADY_ENABLED_REVIEW_REQUIRED');
  const directory=backupDirectory(workspaceRoot);
  privateJson(path.join(directory,'before.json'),before);fs.writeFileSync(path.join(directory,'scheduler-before.bin'),source.bytes,{mode:0o600,flag:'wx'});
  privateJson(path.join(directory,'source-metadata.json'),{contentType:source.contentType,etag:source.etag,entrypoint:source.entrypoint,sha256:sha(source.bytes),canonicalSha256:source.digest,bytes:source.bytes.length});
  report.privateBackupDirectory=path.relative(workspaceRoot,directory).split(path.sep).join('/');
  const current=await inspectCloudflare(api),scriptNow=await downloadSource(env,fetchImpl,current.workers[SCHEDULER].settings),dbNow=await databaseState(env,fetchImpl);assertDatabase(dbNow);
  if(!equal(current,before)||scriptNow.digest!==source.digest||scriptNow.entrypoint!==source.entrypoint||!equal(dbNow,database))fail('BEFORE_STATE_DRIFT');
  await api.request('/accounts/'+api.accountId+'/workers/scripts/'+SCHEDULER,{method:'PUT',body:upload});
  const after=await inspectCloudflare(api),scriptAfter=await downloadSource(env,fetchImpl,after.workers[SCHEDULER].settings);privateJson(path.join(directory,'after.json'),after);
  verifyChange(before,after,connection);if(scriptAfter.entrypoint!==source.entrypoint)fail('SOURCE_ENTRYPOINT_CHANGED_AFTER_WRITE');if(scriptAfter.digest!==source.digest)fail('SOURCE_CHANGED_AFTER_WRITE');
  report.applied=true;report.publicationEnabled=true;report.ready=false;report.verifiedAt=new Date().toISOString();privateJson(path.join(directory,'result.json'),report);return report;
 }catch(error){throw Error(safeError(error));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 configure().then(report=>console.log(JSON.stringify(report))).catch(error=>{console.error(safeError(error));process.exitCode=1;});
