// Worker-native authenticated encryption. The wrapping key belongs in Cloudflare Secrets,
// never in the database, public configuration, browser storage, or an API response.
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const validVersion=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(v);
export function providerKeyReady(env){return /^[a-f0-9]{64}$/i.test(env.PROVIDER_SETTINGS_MASTER_KEY||'')&&validVersion(env.PROVIDER_SETTINGS_KEY_VERSION);}
async function key(env){
 if(!providerKeyReady(env))throw Error('PROVIDER_KEY_REQUIRED');
 return crypto.subtle.importKey('raw',Uint8Array.from(env.PROVIDER_SETTINGS_MASTER_KEY.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
const aad=(provider,mode,version)=>encoder.encode(JSON.stringify(['webnovels-provider-v1',provider,mode,version]));
export async function encryptProviderSettings(value,{provider,mode,env}){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(provider,mode,env.PROVIDER_SETTINGS_KEY_VERSION),tagLength:128},await key(env),encoder.encode(JSON.stringify(value)));
 return {version:1,keyVersion:env.PROVIDER_SETTINGS_KEY_VERSION,iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function decryptProviderSettings(envelope,{provider,mode,env}){
 try{
  if(envelope?.version!==1||envelope.keyVersion!==env.PROVIDER_SETTINGS_KEY_VERSION)throw Error();
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:aad(provider,mode,envelope.keyVersion),tagLength:128},await key(env),bytes(envelope.ciphertext));
  const value=JSON.parse(new TextDecoder().decode(plain));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;
 }catch{throw Error('PROVIDER_KEY_UNAVAILABLE');}
}
