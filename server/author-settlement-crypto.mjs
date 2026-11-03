// Dedicated, versioned wrapping key. No account or provider key fallback.
const encoder=new TextEncoder();
const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
function configuration(env={}){
 const legacy=env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY,active=env.AUTHOR_SETTLEMENT_KEY_VERSION;
 if(!/^[a-f0-9]{64}$/i.test(legacy||'')||!/^v[1-9][0-9]{0,2}$/.test(active||''))throw Error('SETTLEMENT_KEY_REQUIRED');
 let keys={v1:legacy};
 if(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON!==undefined){
  if(typeof env.AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON!=='string'||env.AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON.length>4096)throw Error('SETTLEMENT_KEY_REQUIRED');
  keys=JSON.parse(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEYS_JSON);
  if(!keys||Array.isArray(keys)||typeof keys!=='object'||Object.keys(keys).length>16||Object.keys(keys).length<1||Object.entries(keys).some(([v,k])=>!/^v[1-9][0-9]{0,2}$/.test(v)||typeof k!=='string'||!/^[a-f0-9]{64}$/i.test(k))||keys.v1?.toLowerCase()!==legacy.toLowerCase())throw Error('SETTLEMENT_KEY_REQUIRED');
 }
 if(!Object.hasOwn(keys,active))throw Error('SETTLEMENT_KEY_REQUIRED');return {active,keys};
}
export function settlementKeyReady(env){try{configuration(env);return true;}catch{return false;}}
export function settlementKeyStatus(env){try{const {active,keys}=configuration(env);return {configured:true,activeVersion:active,readVersions:Object.keys(keys).sort(),fingerprintVersion:'v1',legacyFingerprintKeyRequired:true};}catch{return {configured:false,activeVersion:null,readVersions:[],fingerprintVersion:'v1',legacyFingerprintKeyRequired:true};}}
const aad=(context,version)=>encoder.encode(JSON.stringify(['webnovels-settlement-v1',context.userId,context.authorId,context.revision,context.purpose,version]));
async function key(env,algorithm='AES-GCM',version=env.AUTHOR_SETTLEMENT_KEY_VERSION){
 const config=configuration(env),raw=config.keys[algorithm==='HMAC'?'v1':version];if(!raw)throw Error('SETTLEMENT_KEY_REQUIRED');
 return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g),value=>parseInt(value,16)),algorithm==='HMAC'?{name:'HMAC',hash:'SHA-256'}:{name:'AES-GCM'},false,algorithm==='HMAC'?['sign']:['encrypt','decrypt']);
}
export async function encryptSettlement(value,context,env){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(context,env.AUTHOR_SETTLEMENT_KEY_VERSION),tagLength:128},await key(env),encoder.encode(JSON.stringify(value)));
 return {version:1,keyVersion:env.AUTHOR_SETTLEMENT_KEY_VERSION,iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
}
export async function decryptSettlement(envelope,context,env){
 try{
  if(envelope?.version!==1||!/^v[1-9][0-9]{0,2}$/.test(envelope.keyVersion||'')||!/^[A-Za-z0-9+/]{16}$/.test(envelope.iv||'')||typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>290000)throw Error();
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:aad(context,envelope.keyVersion),tagLength:128},await key(env,'AES-GCM',envelope.keyVersion),decode(envelope.ciphertext));
  const value=JSON.parse(new TextDecoder().decode(plain));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;
 }catch{throw Error('SETTLEMENT_KEY_UNAVAILABLE');}
}
export async function settlementFingerprint(value,env){
 // Dedupe and idempotency must not change when the encryption write key rotates.
 const signed=await crypto.subtle.sign('HMAC',await key(env,'HMAC'),encoder.encode(JSON.stringify(['webnovels-settlement-request-v1','v1',value])));
 return Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,'0')).join('');
}
