import {providerKeyReady,encryptProviderSettings,decryptProviderSettings} from './provider-settings-crypto.mjs';
const fields={TOSS:['clientKey','secretKey','merchantId'],PASS:['storeId','channelKey','apiSecret','pgProvider','identifierType','hmacKey','keyVersion']};
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,17})$/.test(v);
export function validateProviderValues(provider,mode,value){
 if(!fields[provider]||!['TEST','LIVE'].includes(mode)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields[provider].includes(k)))return false;
 if(Object.values(value).some(v=>typeof v!=='string'||v.length>2048||/[\s\x00-\x1f\x7f]/.test(v)||!v))return false;
 if(provider==='TOSS')return (!value.clientKey||new RegExp('^'+mode.toLowerCase()+'_(?:g)?ck_[A-Za-z0-9_-]+$').test(value.clientKey))&&
  (!value.secretKey||new RegExp('^'+mode.toLowerCase()+'_(?:g)?sk_[A-Za-z0-9_-]+$').test(value.secretKey))&&
  (!value.merchantId||/^[A-Za-z0-9_-]{1,200}$/.test(value.merchantId))&&!Object.values(value).some(v=>v.includes('_docs_'));
 return (!value.storeId||/^store-[A-Za-z0-9-]+$/.test(value.storeId))&&(!value.channelKey||/^channel-key-[A-Za-z0-9-]+$/.test(value.channelKey))&&
  (!value.pgProvider||['DANAL','INICIS_UNIFIED'].includes(value.pgProvider))&&(!value.identifierType||['CI','DI'].includes(value.identifierType))&&
  !(value.pgProvider==='INICIS_UNIFIED'&&value.identifierType==='DI')&&(!value.hmacKey||/^[a-f0-9]{64}$/i.test(value.hmacKey))&&
  (!value.keyVersion||/^[A-Za-z0-9_-]{1,32}$/.test(value.keyVersion));
}
async function readBody(request,fail){
 if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_PROVIDER_SETTINGS');
 const parts=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
  if(size>16000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}parts.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_PROVIDER_SETTINGS');}
}
export async function providerSettingsApi({request,user,actor,remote,rpc,fail,env={}}){
 if(!actor.admin?.is_active||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');
 const url=new URL(request.url);
 if([...url.searchParams.keys()].length)fail(400,'INVALID_QUERY');
 const call=(action,data={})=>rpc('manage_provider_settings',{p_user:user.id,p_action:action,p_data:data});
 if(request.method==='GET')return {...await call('list'),keyReady:providerKeyReady(env),activationAvailable:false};
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(!providerKeyReady(env))fail(503,'PROVIDER_KEY_REQUIRED');
 const data=await readBody(request,fail);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['provider','mode','revision','values','password','action'].includes(k))||
  !fields[data.provider]||!['TEST','LIVE'].includes(data.mode)||!revision(data.revision)||!['save','clear'].includes(data.action))fail(400,'INVALID_PROVIDER_SETTINGS');
 if(typeof data.password!=='string'||!data.password||data.password.length>1024||!user.email)fail(400,'ADMIN_REAUTH_REQUIRED');
 if(data.action==='save'&&!validateProviderValues(data.provider,data.mode,data.values))fail(400,'INVALID_PROVIDER_SETTINGS');
 if(data.action==='clear'&&data.values!==undefined)fail(400,'FIELD_NOT_ALLOWED');
 // Count attempts before password verification; error paths cannot bypass the DB limit.
 await call('attempt');
 const login=await remote('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:user.email,password:data.password})});
 data.password='';
 if(!login.ok)fail(login.status===429?429:login.status>=500?503:403,login.status===429?'RATE_LIMITED':login.status>=500?'AUTH_UNAVAILABLE':'ADMIN_REAUTH_FAILED');
 const proof=await login.json();if(!proof.access_token)fail(503,'ADMIN_REAUTH_FAILED');
 const logout=await remote('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+proof.access_token}});
 if(!logout.ok||proof.user?.id!==user.id)fail(403,'ADMIN_REAUTH_FAILED');
 if(data.action==='clear')return call('clear',{provider:data.provider,mode:data.mode,revision:data.revision});
 const old=await call('get',{provider:data.provider,mode:data.mode});
 if((old.revision||'0')!==data.revision)fail(409,'CONFLICT');
 let values={};
 if(old.envelope)try{values=await decryptProviderSettings(old.envelope,{provider:data.provider,mode:data.mode,env});}catch{fail(503,'PROVIDER_KEY_UNAVAILABLE');}
 values={...values,...data.values};
 if(!validateProviderValues(data.provider,data.mode,values))fail(400,'INVALID_PROVIDER_SETTINGS');
 let envelope;try{envelope=await encryptProviderSettings(values,{provider:data.provider,mode:data.mode,env});}catch{fail(503,'PROVIDER_KEY_UNAVAILABLE');}
 return call('save',{provider:data.provider,mode:data.mode,revision:data.revision,envelope,
  configuredFields:fields[data.provider].filter(f=>!!values[f]),complete:fields[data.provider].every(f=>!!values[f])});
}
// Used only after an operator has reviewed the exact saved revision and enabled the
// existing provider-specific service gates. Saving credentials never performs activation.
export async function resolveStoredProviderSettings({provider,mode,env,rpc}){
 if(env.PROVIDER_SETTINGS_SOURCE!=='database')return null;
 const row=await rpc('provider_runtime_config',{p_provider:provider,p_mode:mode});
 if(!row?.enabled||!row.envelope)throw Error('PROVIDER_NOT_ACTIVATED');
 const value=await decryptProviderSettings(row.envelope,{provider,mode,env});
 if(!validateProviderValues(provider,mode,value)||!fields[provider].every(f=>!!value[f]))throw Error('PROVIDER_CONFIGURATION_REQUIRED');
 return value;
}
