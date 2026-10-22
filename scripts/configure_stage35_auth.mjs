// Inspect by default. --apply changes only the public Auth redirect and optional SMTP settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import access from './lib/launch-access.cjs';
export const BETA_SITE_URL='https://webnovels-db4.pages.dev';
export const BETA_REDIRECT_URLS=Object.freeze(['/?auth=confirm','/?auth=recovery'].map(p=>BETA_SITE_URL+p));
// Supabase's allow list is glob syntax: escape '?' so it remains a literal query separator.
export const BETA_REDIRECT_PATTERNS=Object.freeze(BETA_REDIRECT_URLS.map(url=>url.replace('?',String.raw`\?`)));
export const SMTP_KEYS=Object.freeze(['BETA_SMTP_HOST','BETA_SMTP_PORT','BETA_SMTP_USER','BETA_SMTP_PASS','BETA_SMTP_ADMIN_EMAIL','BETA_SMTP_SENDER_NAME']);
const root=fileURLToPath(new URL('../',import.meta.url));
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const knownText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const list=config=>typeof config.uri_allow_list==='string'?config.uri_allow_list.split(',').map(x=>x.trim()).filter(Boolean):[];
export function buildAuthPatch(current,env={}){
 if(!object(current)||typeof current.site_url!=='string'||typeof current.mailer_autoconfirm!=='boolean'||
  (current.uri_allow_list!=null&&typeof current.uri_allow_list!=='string'))fail('AUTH_CONFIG_INVALID');
 const existing=list(current);
 if(existing.some(s=>s.length>2048||/[\x00-\x1f\x7f]/.test(s))||existing.length>200)fail('AUTH_REDIRECT_REVIEW_REQUIRED');
 // Preserve existing administrator-approved destinations; never add wildcard hosts/paths.
 const patch={site_url:BETA_SITE_URL,uri_allow_list:[...new Set([...existing,...BETA_REDIRECT_PATTERNS])].join(','),mailer_autoconfirm:false};
 const supplied=SMTP_KEYS.filter(key=>Object.hasOwn(env,key));
 if(!supplied.length)return patch;
 if(supplied.length!==SMTP_KEYS.length||SMTP_KEYS.some(key=>!knownText(env[key],key==='BETA_SMTP_PASS'?4096:512)))fail('BETA_SMTP_ALL_SIX_FIELDS_REQUIRED');
 if(current.hook_send_email_enabled===true)fail('BETA_SMTP_EMAIL_HOOK_REVIEW_REQUIRED');
 const host=env.BETA_SMTP_HOST.trim(),port=env.BETA_SMTP_PORT.trim(),email=env.BETA_SMTP_ADMIN_EMAIL.trim(),sender=env.BETA_SMTP_SENDER_NAME.trim();
 if(host.length>253||!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))fail('BETA_SMTP_HOST_INVALID');
 if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)fail('BETA_SMTP_PORT_INVALID');
 if(email.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))fail('BETA_SMTP_EMAIL_INVALID');
 if(sender.length>120||/[<>]/.test(sender)||env.BETA_SMTP_USER.length>320)fail('BETA_SMTP_SENDER_INVALID');
 // Match Supabase's documented initial custom-SMTP allowance only when replacing its 2/hour default.
 // Existing custom SMTP or an operator-selected limit remains unchanged.
 const initialRate=!current.smtp_host&&current.rate_limit_email_sent===2?{rate_limit_email_sent:30}:{};
 return {...patch,...initialRate,smtp_host:host,smtp_port:String(Number(port)),smtp_user:env.BETA_SMTP_USER.trim(),
  smtp_pass:env.BETA_SMTP_PASS,smtp_admin_email:email,smtp_sender_name:sender};
}
export function summarizeAuthConfig(current){
 if(!object(current))fail('AUTH_CONFIG_INVALID');
 let siteHostname=null;try{siteHostname=new URL(current.site_url).hostname;}catch{}
 const redirects=list(current),smtpReady=!!(current.smtp_host&&current.smtp_user&&current.smtp_pass&&current.smtp_admin_email&&current.smtp_port);
 const publicRedirectsReady=current.site_url?.replace(/\/$/,'')===BETA_SITE_URL&&BETA_REDIRECT_PATTERNS.every(p=>redirects.includes(p));
 const emailConfirmationRequired=current.mailer_autoconfirm===false,signupDisabled=current.disable_signup===true;
 return {siteHostname,publicRedirectsReady,redirectCount:redirects.length,smtpReady,
  smtpHostConfigured:!!current.smtp_host,smtpUserConfigured:!!current.smtp_user,smtpPasswordConfigured:!!current.smtp_pass,
  sendEmailHookEnabled:current.hook_send_email_enabled===true,sendEmailHookConfigured:!!current.hook_send_email_uri,
  emailConfirmationRequired,signupDisabled,emailProviderEnabled:current.external_email_enabled===true,
  emailConfigReady:smtpReady&&publicRedirectsReady&&emailConfirmationRequired&&!signupDisabled&&current.external_email_enabled===true,
  emailRateLimit:Number.isFinite(current.rate_limit_email_sent)?current.rate_limit_email_sent:null,deliveryVerified:false};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function touched(config,patch){return Object.fromEntries(Object.keys(patch).map(key=>[key,config[key]??null]));}
async function backupConfig(config,ref){
 // All raw provider configuration stays under ignored scratch, never in artifacts or stdout.
 const relative='scratch/launch/backups/auth-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
 try{execFileSync('git',['check-ignore','--quiet','--',relative+'/config.json'],{cwd:root,stdio:'ignore'});}catch{fail('AUTH_BACKUP_MUST_BE_GIT_IGNORED');}
 const directory=path.join(root,relative);let at=root;
 for(const part of relative.split('/')){
  at=path.join(at,part);try{await fs.mkdir(at,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const info=await fs.lstat(at);if(info.isSymbolicLink()||!info.isDirectory())fail('AUTH_BACKUP_PATH_UNSAFE');
 }
 if(!path.relative(await fs.realpath(root),await fs.realpath(directory)).startsWith('scratch'+path.sep))fail('AUTH_BACKUP_PATH_UNSAFE');
 const bytes=JSON.stringify({format:'webnovels-auth-config-backup-v1',projectRef:ref,createdAt:new Date().toISOString(),config},null,2)+'\n';
 await fs.writeFile(path.join(directory,'config.json'),bytes,{encoding:'utf8',mode:0o600,flag:'wx'});
 return {path:relative.replaceAll('\\','/')+'/config.json',sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function configureAuth({env,apply=false,fetcher=fetch,saveBackup=backupConfig,saveReport=async()=>{}}){
 const {ref}=access.connection(env),token=access.managementToken(env);
 const url=`https://api.supabase.com/v1/projects/${ref}/config/auth`;
 const request=async(method='GET',payload)=>{
  let response;try{response=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{fail('AUTH_CONFIG_NETWORK_FAILED');}
  if(!response.ok)fail('AUTH_CONFIG_HTTP_'+response.status);
  let data;try{data=await response.json();}catch{fail('AUTH_CONFIG_RESPONSE_INVALID');}
  if(!object(data))fail('AUTH_CONFIG_RESPONSE_INVALID');return data;
 };
 const before=await request(),patch=buildAuthPatch(before,env),checkedAt=new Date().toISOString();
 const report={format:'webnovels-stage35-auth-config-v1',projectRef:ref,checkedAt,applied:false,applyAttempted:false,
  configurationVerified:false,verifiedAt:null,smtpInputProvided:Object.hasOwn(patch,'smtp_host'),
  plannedFields:Object.keys(patch),...summarizeAuthConfig(before)};
 if(!apply){await saveReport(report);return report;}
 const backup=await saveBackup(before,ref);report.backup=backup;
 const latest=await request();
 if(digest(touched(before,patch))!==digest(touched(latest,patch)))fail('AUTH_CONFIG_CHANGED_RETRY_REQUIRED');
 report.applyAttempted=true;await saveReport(report);
 try{
  await request('PATCH',patch);report.applied=true;await saveReport(report);
  const after=await request();
  // API may mask secrets on GET. Compare all non-secret fields and require a stored credential indicator.
  if(Object.entries(patch).some(([key,value])=>key!=='smtp_pass'&&after[key]!==value)||
   (Object.hasOwn(patch,'smtp_pass')&&!after.smtp_pass))fail('AUTH_CONFIG_READBACK_MISMATCH');
  Object.assign(report,summarizeAuthConfig(after),{configurationVerified:true,verifiedAt:new Date().toISOString()});
  await saveReport(report);return report;
 }catch(error){report.errorCode=error.safeCode||'AUTH_CONFIG_APPLY_FAILED';await saveReport(report);throw error;}
}
export const safeAuthError=error=>typeof error?.safeCode==='string'&&/^(AUTH_CONFIG|AUTH_BACKUP|AUTH_REDIRECT|BETA_SMTP)_[A-Z0-9_]+$/.test(error.safeCode)?error.safeCode:'AUTH_CONFIG_OPERATION_FAILED';
async function main(){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply')||args.length>1)fail('AUTH_CONFIG_ARGUMENT_INVALID');
 if(path.resolve(process.cwd())!==path.resolve(root))fail('AUTH_CONFIG_REPOSITORY_ROOT_REQUIRED');
 const env=access.loadEnv();
 const saveReport=async report=>{await fs.mkdir(path.join(root,'artifacts'),{recursive:true});await fs.writeFile(path.join(root,'artifacts/stage35-auth-config.json'),JSON.stringify(report,null,2)+'\n');};
 const report=await configureAuth({env,apply:args.includes('--apply'),saveReport});
 console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(safeAuthError(error));process.exitCode=1;});
