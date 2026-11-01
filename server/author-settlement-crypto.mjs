// Dedicated, versioned wrapping key. No account or provider key fallback.
const encoder=new TextEncoder();
const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
export function settlementKeyReady(env){return /^[a-f0-9]{64}$/i.test(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY||'')&&env.AUTHOR_SETTLEMENT_KEY_VERSION==='v1';}
const aad=(context,version)=>encoder.encode(JSON.stringify(['webnovels-settlement-v1',context.userId,context.authorId,context.revision,context.purpose,version]));
async function key(env,algorithm='AES-GCM'){
 if(!settlementKeyReady(env))throw Error('SETTLEMENT_KEY_REQUIRED');
 return crypto.subtle.importKey('raw',Uint8Array.from(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY.match(/../g),value=>parseInt(value,16)),algorithm==='HMAC'?{name:'HMAC',hash:'SHA-256'}:{name:'AES-GCM'},false,algorithm==='HMAC'?['sign']:['encrypt','decrypt']);
}
export async function encryptSettlement(value,context,env){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(context,env.AUTHOR_SETTLEMENT_KEY_VERSION),tagLength:128},await key(env),encoder.encode(JSON.stringify(value)));
 return {version:1,keyVersion:env.AUTHOR_SETTLEMENT_KEY_VERSION,iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
}
export async function decryptSettlement(envelope,context,env){
 try{
  if(envelope?.version!==1||envelope.keyVersion!==env.AUTHOR_SETTLEMENT_KEY_VERSION||!/^[A-Za-z0-9+/]{16}$/.test(envelope.iv||'')||typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>290000)throw Error();
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:aad(context,envelope.keyVersion),tagLength:128},await key(env),decode(envelope.ciphertext));
  const value=JSON.parse(new TextDecoder().decode(plain));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;
 }catch{throw Error('SETTLEMENT_KEY_UNAVAILABLE');}
}
export async function settlementFingerprint(value,env){
 const signed=await crypto.subtle.sign('HMAC',await key(env,'HMAC'),encoder.encode(JSON.stringify(['webnovels-settlement-request-v1',env.AUTHOR_SETTLEMENT_KEY_VERSION,value])));
 return Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,'0')).join('');
}
