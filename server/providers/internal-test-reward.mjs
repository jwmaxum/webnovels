// OP06_INTERNAL_TEST_V1 is a private TEST harness protocol, not Google SSV.
// Verify the original UTF-8 bytes before interpreting or forwarding any claim.
import {pointsTestEnabled} from '../points-test-api.mjs';

const protocol='OP06_INTERNAL_TEST_V1',providers=['NONE','INTERNAL_TEST'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const safe=(value,max)=>typeof value==='string'&&new RegExp('^[A-Za-z0-9_-]{1,'+max+'}$').test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const exact=(value,fields)=>object(value)&&Object.keys(value).length===fields.length&&Object.keys(value).every(key=>fields.includes(key));
const bytes=value=>Uint8Array.from(value.match(/../g),part=>parseInt(part,16));
const hex=value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
const verifiedProofs=new WeakSet();
export const isVerifiedInternalTestProof=value=>object(value)&&verifiedProofs.has(value);

function configuration(env){
 if(!pointsTestEnabled(env)||env.AD_REWARDS_TEST_ENABLED!=='true'||env.AD_REWARDS_TEST_ENVIRONMENT!=='TEST'||!providers.includes(env.AD_REWARDS_TEST_PROVIDER??'NONE')||env.AD_REWARDS_TEST_PROVIDER!=='INTERNAL_TEST'||env.AD_REWARDS_TEST_CALLBACK_ENABLED!=='true'||
  !safe(env.AD_REWARDS_TEST_CHANNEL_ID,80)||!safe(env.AD_REWARDS_TEST_KEY_ID,32)||typeof env.AD_REWARDS_TEST_SECRET!=='string'||!/^[a-f0-9]{64}$/i.test(env.AD_REWARDS_TEST_SECRET))return null;
 return {channelId:env.AD_REWARDS_TEST_CHANNEL_ID,keyId:env.AD_REWARDS_TEST_KEY_ID,secret:env.AD_REWARDS_TEST_SECRET.toLowerCase()};
}
async function binding(config){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([protocol,config.channelId,config.keyId,config.secret]))));}
export async function internalTestRewardChannel(env={}){
 const config=configuration(env);return config?{provider:'INTERNAL_TEST',channelId:config.channelId,binding:await binding(config)}:{provider:'NONE',channelId:null,binding:null};
}

async function rawBody(request,fail){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
 if(request.headers.has('content-encoding')&&!/^identity$/i.test(request.headers.get('content-encoding')))fail(415,'ENCODING_NOT_SUPPORTED');
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))fail(413,'BODY_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');const chunks=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 if(!size)fail(400,'BODY_REQUIRED');const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.byteLength;}return result;
}
export async function verifyInternalTestCallback({request,env={},fail}){
 const config=configuration(env);if(!config)fail(503,'AD_REWARD_PROVIDER_NOT_READY');
 const url=new URL(request.url);if(url.pathname!=='/api/v2/ad-rewards-test/callback')fail(404,'NOT_FOUND');
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(url.search||url.hash)fail(400,'INVALID_QUERY');
 const keyId=request.headers.get('x-wn-test-key-id'),time=request.headers.get('x-wn-test-timestamp'),signature=request.headers.get('x-wn-test-signature');
 if(keyId!==config.keyId||!safe(keyId,32)||!/^(0|[1-9]\d{0,10})$/.test(time||'')||!Number.isSafeInteger(Number(time))||Math.abs(Math.floor(Date.now()/1000)-Number(time))>300||!/^[a-f0-9]{64}$/i.test(signature||''))fail(403,'INVALID_TEST_SIGNATURE');
 const raw=await rawBody(request,fail),prefix=new TextEncoder().encode(time+'.'),signed=new Uint8Array(prefix.byteLength+raw.byteLength);signed.set(prefix);signed.set(raw,prefix.byteLength);
 const key=await crypto.subtle.importKey('raw',bytes(config.secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,bytes(signature),signed))fail(403,'INVALID_TEST_SIGNATURE');
 let source,data;try{source=new TextDecoder('utf-8',{fatal:true}).decode(raw);data=JSON.parse(source);}catch{fail(400,'INVALID_REWARD_EVIDENCE');}
 const fields=['protocol','eventId','sessionId','nonce','channelId','outcome','completedAt','reward'];
 if(!exact(data,fields)||data.protocol!==protocol||!safe(data.eventId,128)||!uuid(data.sessionId)||typeof data.nonce!=='string'||!/^[a-f0-9]{64}$/.test(data.nonce)||data.channelId!==config.channelId||!['GRANTED','NO_FILL','REJECTED'].includes(data.outcome)||!timestamp(data.completedAt)||!exact(data.reward,['type','quantity'])||data.reward.type!=='EPISODE_ACCESS'||data.reward.quantity!==1)fail(400,'INVALID_REWARD_EVIDENCE');
 // Every allowed value is a constrained string/number without embedded key
 // syntax. Decode the ten JSON key tokens too, so duplicate/escaped aliases
 // cannot be silently discarded by JSON.parse, including in reward objects.
 const names=[...source.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)].map(match=>JSON.parse('"'+match[1]+'"'));
 if(names.length!==10||new Set(names).size!==10||names.some(name=>![...fields,'type','quantity'].includes(name)))fail(400,'INVALID_REWARD_EVIDENCE');
 const proof=Object.freeze({...data,sessionId:data.sessionId.toLowerCase(),completedAt:new Date(data.completedAt).toISOString(),reward:Object.freeze({type:'EPISODE_ACCESS',quantity:1}),provider:'INTERNAL_TEST',binding:await binding(config),bodyDigest:hex(await crypto.subtle.digest('SHA-256',raw))});
 verifiedProofs.add(proof);return proof;
}
