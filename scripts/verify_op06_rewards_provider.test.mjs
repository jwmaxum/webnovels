import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {verifyInternalTestCallback,internalTestRewardChannel,isVerifiedInternalTestProof} from '../server/providers/internal-test-reward.mjs';

const env={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true',AD_REWARDS_TEST_ENABLED:'true',AD_REWARDS_TEST_ENVIRONMENT:'TEST',AD_REWARDS_TEST_PROVIDER:'INTERNAL_TEST',AD_REWARDS_TEST_CALLBACK_ENABLED:'true',AD_REWARDS_TEST_CHANNEL_ID:'internal_test_channel',AD_REWARDS_TEST_KEY_ID:'key_test',AD_REWARDS_TEST_SECRET:'1'.repeat(64)};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const evidence=()=>({protocol:'OP06_INTERNAL_TEST_V1',eventId:'event-'+randomUUID(),sessionId:randomUUID(),nonce:'a'.repeat(64),channelId:env.AD_REWARDS_TEST_CHANNEL_ID,outcome:'GRANTED',completedAt:new Date().toISOString(),reward:{type:'EPISODE_ACCESS',quantity:1}});
function request({data=evidence(),raw=JSON.stringify(data),settings=env,time=String(Math.floor(Date.now()/1000)),headers={},method='POST',path='/api/v2/ad-rewards-test/callback',signature,signingRaw=raw}={}){
 const bytes=typeof raw==='string'?Buffer.from(raw):Buffer.from(raw),signed=Buffer.concat([Buffer.from(time+'.'),typeof signingRaw==='string'?Buffer.from(signingRaw):Buffer.from(signingRaw)]);
 return new Request('https://site.test'+path,{method,headers:{'content-type':'application/json','x-wn-test-key-id':settings.AD_REWARDS_TEST_KEY_ID,'x-wn-test-timestamp':time,'x-wn-test-signature':signature??createHmac('sha256',Buffer.from(settings.AD_REWARDS_TEST_SECRET,'hex')).update(signed).digest('hex'),...headers},...(!['GET','HEAD'].includes(method)?{body:bytes}:{})});
}
const verify=(options={})=>verifyInternalTestCallback({request:request(options),env:options.settings??env,fail});
const reject=async(options,code)=>assert.rejects(verify(options),e=>!code||e.code===code);

test('internal TEST provider readiness requires exact independent gates, callback and scoped secret configuration',async()=>{
 assert.equal((await internalTestRewardChannel(env)).provider,'INTERNAL_TEST');assert.deepEqual(await internalTestRewardChannel(),{provider:'NONE',channelId:null,binding:null});
 for(const key of ['POINTS_TEST_ENABLED','P0_API_ENABLED','AD_REWARDS_TEST_ENABLED','AD_REWARDS_TEST_ENVIRONMENT','AD_REWARDS_TEST_PROVIDER','AD_REWARDS_TEST_CALLBACK_ENABLED'])for(const value of [undefined,true,'LIVE','FALSE']){
  const settings={...env,[key]:value};assert.equal((await internalTestRewardChannel(settings)).provider,'NONE');await assert.rejects(verifyInternalTestCallback({request:request(),env:settings,fail}),e=>e.code==='AD_REWARD_PROVIDER_NOT_READY');
 }
 for(const patch of [{FREE_BETA_ENABLED:'true'},{FREE_BETA_ENABLED:true},{AD_REWARDS_TEST_CHANNEL_ID:'bad channel'},{AD_REWARDS_TEST_KEY_ID:'bad/key'},{AD_REWARDS_TEST_SECRET:'f'.repeat(63)},{AD_REWARDS_TEST_SECRET:'not-a-secret'}])assert.equal((await internalTestRewardChannel({...env,...patch})).provider,'NONE');
});

test('valid raw HMAC proof is branded and deeply frozen with private current binding and body digest',async()=>{
 const data=evidence(),raw=JSON.stringify(data),proof=await verify({data,raw});assert.equal(isVerifiedInternalTestProof(proof),true);assert.equal(isVerifiedInternalTestProof({...proof}),false);assert.equal(Object.isFrozen(proof),true);assert.equal(Object.isFrozen(proof.reward),true);
 assert.equal(proof.bodyDigest,createHash('sha256').update(raw).digest('hex'));assert.equal(proof.binding,(await internalTestRewardChannel(env)).binding);assert.match(proof.binding,/^[a-f0-9]{64}$/);assert.equal(proof.provider,'INTERNAL_TEST');
 assert.throws(()=>proof.reward.quantity=999,TypeError);assert.doesNotMatch(JSON.stringify(proof),/secret|signature|key_test/);assert.equal(proof.completedAt,new Date(data.completedAt).toISOString());
});

test('original whitespace, key order and valid Unicode escapes are signed without reserializing bytes',async()=>{
 const data=evidence(),raw=JSON.stringify(data,null,2).replace('"protocol"','"\\u0070rotocol"'),proof=await verify({raw});assert.equal(proof.protocol,'OP06_INTERNAL_TEST_V1');assert.equal(proof.bodyDigest,createHash('sha256').update(raw).digest('hex'));
 const reordered=JSON.stringify({reward:data.reward,...data});assert.equal((await verify({raw:reordered})).sessionId,data.sessionId);
 await reject({raw:raw+' ',signingRaw:raw},'INVALID_TEST_SIGNATURE');
});

test('one-byte body, outcome, reward or nonce tampering fails authentication before interpretation',async()=>{
 const data=evidence(),raw=JSON.stringify(data);
 for(const changed of [raw.replace('GRANTED','NO_FILL'),raw.replace('EPISODE_ACCESS','COINS'),raw.replace('"quantity":1','"quantity":9'),raw.replace('a'.repeat(64),'b'.repeat(64)),raw.replace('event-','other-')])await reject({raw:changed,signingRaw:raw},'INVALID_TEST_SIGNATURE');
 await reject({raw,signature:'0'.repeat(64)},'INVALID_TEST_SIGNATURE');
});

test('unknown key, stale/future header, malformed signatures and duplicate headers fail closed',async()=>{
 for(const patch of [{headers:{'x-wn-test-key-id':'different'}},{time:String(Math.floor(Date.now()/1000)-301)},{time:String(Math.floor(Date.now()/1000)+301)},{time:'01'},{time:'1e9'},{signature:'ab'},{signature:'z'.repeat(64)},{headers:{'x-wn-test-key-id':env.AD_REWARDS_TEST_KEY_ID+', '+env.AD_REWARDS_TEST_KEY_ID}},{headers:{'x-wn-test-timestamp':'1, 1'}},{headers:{'x-wn-test-signature':'a'.repeat(64)+', '+'a'.repeat(64)}}])await reject(patch,'INVALID_TEST_SIGNATURE');
});

test('callback methods, query, media type, encoding and byte bounds are strict',async()=>{
 for(const options of [{method:'GET'},{path:'/api/v2/ad-rewards-test/callback?action=grant'},{path:'/api/v2/ad-rewards-test/callback/'},{headers:{'content-type':'text/plain'}},{headers:{'content-encoding':'gzip'}},{raw:'x'.repeat(16385)},{headers:{'content-length':'16385'}}])await reject(options);
});

test('authenticated invalid JSON, UTF8, schema, trusted fields and duplicate escaped keys never become proofs',async()=>{
 const data=evidence();
 for(const raw of ['{',Buffer.from([255]),JSON.stringify([]),JSON.stringify(null),JSON.stringify({...data,userId:randomUUID()}),JSON.stringify({...data,binding:'b'.repeat(64)}),JSON.stringify({...data,protocol:'GOOGLE_SSV'}),JSON.stringify({...data,reward:{type:'POINTS',quantity:10000}}),JSON.stringify({...data,reward:{type:'EPISODE_ACCESS',quantity:2}}),JSON.stringify({...data,completedAt:'2026-02-30T00:00:00Z'}),JSON.stringify({...data,nonce:'x'}),JSON.stringify({...data,channelId:'other'}),JSON.stringify({...data,outcome:'CLICKED'}),JSON.stringify(data).replace('"eventId":','"eventId":"duplicate","eventId":'),JSON.stringify(data).replace('"quantity":1','"quantity":1,"\\u0071uantity":1')])await reject({raw},'INVALID_REWARD_EVIDENCE');
});

test('stable proof replay does not encode transport time in the body digest; key and channel rotations change binding',async()=>{
 const data=evidence(),first=await verify({data}),second=await verify({data,time:String(Math.floor(Date.now()/1000)-1)});assert.equal(first.bodyDigest,second.bodyDigest);assert.equal(first.binding,second.binding);
 for(const patch of [{AD_REWARDS_TEST_SECRET:'2'.repeat(64)},{AD_REWARDS_TEST_KEY_ID:'other_key'},{AD_REWARDS_TEST_CHANNEL_ID:'other_channel'}])assert.notEqual((await internalTestRewardChannel({...env,...patch})).binding,first.binding);
 const settings={...env,AD_REWARDS_TEST_SECRET:'2'.repeat(64)};await assert.rejects(verifyInternalTestCallback({request:request({data}),env:settings,fail}),e=>e.code==='INVALID_TEST_SIGNATURE');
});
