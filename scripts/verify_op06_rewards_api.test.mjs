import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {adRewardsTestEnabled,adRewardsTestApi,adRewardsTestCallback,verifyInternalTestCallback} from '../server/ad-rewards-test-api.mjs';

const uid=randomUUID(),other=randomUUID(),sid=randomUUID(),version=randomUUID(),grantId=randomUUID();
const env={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true',AD_REWARDS_TEST_ENABLED:'true',AD_REWARDS_TEST_ENVIRONMENT:'TEST'};
const internal={...env,AD_REWARDS_TEST_PROVIDER:'INTERNAL_TEST',AD_REWARDS_TEST_CALLBACK_ENABLED:'true',AD_REWARDS_TEST_CHANNEL_ID:'internal_test_channel',AD_REWARDS_TEST_KEY_ID:'key_test',AD_REWARDS_TEST_SECRET:'1'.repeat(64)};
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED',provider:'NONE'},fallback={kind:'POINTS',chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100};
const user={id:uid,email_confirmed_at:'2026-01-01T00:00:00Z'},reader={userId:uid,reader:{status:'ACTIVE'}},admin={userId:uid,admin:{role:'SUPER_ADMIN',is_active:true}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const policy=()=>({id:version,adEnabled:false,campaignEnabled:false,rewardHours:24,sessionMinutes:5,graceMinutes:10,dailyLimit:20,campaignTitle:'',campaignStartsAt:null,campaignEndsAt:null});
const session=()=>({id:sid,episodeId:'3',kind:'AD_REWARD',status:'WAITING_EVIDENCE',createdAt:'2026-11-02T00:00:00Z',expiresAt:'2026-11-02T00:05:00Z',acceptUntil:'2026-11-02T00:15:00Z',closedAt:null,rewardHours:24,policyVersion:version,grant:null});
const options=()=>({...marker,episodeId:'3',access:'LOCKED',availability:'UNAVAILABLE',adAvailable:false,campaignAvailable:false,policy:policy(),fallback});
const state=()=>({...marker,revision:'0',providerReady:false,policy:policy()});
function fixture({action='options',isAdmin=false,data,query=action==='options'?'episodeId=3':'',method,settings=env,who=isAdmin?admin:reader,auth=user,result,rpcImpl,headers={},request:custom}={}){
 const write=isAdmin||!['options','status'].includes(action),verb=method??(write?'POST':'GET');
 const request=custom??new Request('https://site.test/api/v2/'+(isAdmin?'admin/':'')+'ad-rewards-test?action='+action+(query?'&'+query:''),{method:verb,headers:{origin:'https://site.test','content-type':'application/json',...headers},...(!['GET','HEAD'].includes(verb)?{body:typeof data==='string'?data:JSON.stringify(data??{})}:{})});
 const calls=[],rpc=async(name,payload)=>{calls.push({name,payload});return rpcImpl?rpcImpl(name,payload):result??(isAdmin?state():options());};
 return {calls,run:()=>adRewardsTestApi({request,user:auth,actor:who,rpc,env:settings,fail})};
}
async function reject(options,code,count=0){const f=fixture(options);await assert.rejects(f.run(),e=>!code||e.code===code);assert.equal(f.calls.length,count);}
async function signedProof(data,settings=internal){const raw=JSON.stringify(data),time=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',Buffer.from(settings.AD_REWARDS_TEST_SECRET,'hex')).update(time+'.'+raw).digest('hex');return verifyInternalTestCallback({request:new Request('https://site.test/api/v2/ad-rewards-test/callback',{method:'POST',headers:{'content-type':'application/json','x-wn-test-key-id':settings.AD_REWARDS_TEST_KEY_ID,'x-wn-test-timestamp':time,'x-wn-test-signature':signature},body:raw}),env:settings,fail});}
const evidence=()=>({protocol:'OP06_INTERNAL_TEST_V1',eventId:'event-'+randomUUID(),sessionId:sid,nonce:'a'.repeat(64),channelId:internal.AD_REWARDS_TEST_CHANNEL_ID,outcome:'GRANTED',completedAt:new Date().toISOString(),reward:{type:'EPISODE_ACCESS',quantity:1}});

test('independent reward TEST gate permits NONE without charging and closes LIVE, free beta and loose booleans',()=>{
 assert.equal(adRewardsTestEnabled(env),true);assert.equal(adRewardsTestEnabled({...env,CHARGING_TEST_ENABLED:'false'}),true);assert.equal(adRewardsTestEnabled(),false);
 for(const key of Object.keys(env))for(const value of [undefined,true,false,'LIVE','TRUE'])assert.equal(adRewardsTestEnabled({...env,[key]:value}),false);
 for(const value of ['LIVE','GOOGLE','ADMOB','INTERNAL_TEST_HMAC',true])assert.equal(adRewardsTestEnabled({...env,AD_REWARDS_TEST_PROVIDER:value}),false);
 for(const value of [true,'true'])assert.equal(adRewardsTestEnabled({...env,FREE_BETA_ENABLED:value}),false);
});

test('confirmed Auth/current active reader or SUPER_ADMIN is required before any RPC',async()=>{
 await reject({settings:{},auth:null,who:null},'AD_REWARDS_TEST_NOT_ACTIVATED');
 for(const auth of [null,{...user,is_anonymous:true},{...user,deleted_at:'2026-01-01'},{...user,banned_until:'invalid'},{...user,banned_until:'2999-01-01'}])await reject({auth},'INVALID_SESSION');
 await reject({auth:{id:uid}},'EMAIL_CONFIRMATION_REQUIRED');await reject({who:{...reader,userId:other}},'INVALID_SESSION');await reject({who:{userId:uid,reader:{status:'BLOCKED'}}},'READER_REQUIRED');
 for(const who of [reader,{...admin,admin:{role:'SUB_ADMIN',is_active:true,permissions:['CURATION_WRITE']}},{...admin,admin:{role:'SUPER_ADMIN',is_active:false}}])await reject({isAdmin:true,action:'state',query:'',who},'ADMIN_FORBIDDEN');
});

test('methods, duplicate/extra query, Origin, bounded UTF8 JSON and browser evidence fields fail before RPC',async()=>{
 for(const patch of [{method:'POST'},{query:'episodeId=3&episodeId=4'},{query:'episodeId=03'},{query:'episodeId=3&userId='+other},{query:'episodeId=3&action=options'},{action:'unknown',query:''},{action:'status',query:'sessionId=bad'}])await reject(patch);
 const data={episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()};
 for(const patch of [{headers:{origin:'https://evil.test'}},{headers:{'content-type':'text/plain'}},{data:'{'},{data:' '.repeat(16385)},{data:{...data,provider:'INTERNAL_TEST'}},{data:{...data,binding:'a'.repeat(64)}},{data:{...data,nonce:'a'.repeat(64)}},{data:{...data,reward:{quantity:10000}}},{data:{...data,kind:'POINTS'}},{data:{...data,consent:false}},{data:{...data,policyVersion:undefined}},{data:{...data,policyVersion:'bad'}},{data:{...data,requestId:[data.requestId]}}])await reject({action:'start',query:'',data,...patch});
 const request=new Request('https://site.test/api/v2/ad-rewards-test?action=start',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:new Uint8Array([255])});await reject({request});
});

test('NONE options preserve explicit 10000KRW/10000P fallback without issuing rights or calling a provider',async()=>{
 const f=fixture({result:{...options(),privateKey:'PRIVATE',policy:{...policy(),secret:'PRIVATE'},fallback:{...fallback,nonce:'PRIVATE'}}}),value=await f.run();assert.deepEqual(value.fallback,fallback);assert.equal(value.adAvailable,false);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|secret|nonce/);assert.equal(f.calls[0].payload.p_user,uid);assert.deepEqual(f.calls[0].payload.p_data,{episodeId:'3',provider:'NONE',channelId:null,binding:null});
 const start=fixture({action:'start',query:'',data:{episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()},result:{...marker,availability:'UNAVAILABLE',session:null,fallback,replayed:false}});assert.equal((await start.run()).session,null);assert.equal(start.calls.length,1);
});

test('only server-derived ready channel/binding enters options/start; incomplete keys remain unavailable',async()=>{
 const ready=fixture({settings:internal,result:{...options(),provider:'INTERNAL_TEST',availability:'INTERNAL_TEST',adAvailable:true}});assert.equal((await ready.run()).adAvailable,true);const data=ready.calls[0].payload.p_data;assert.equal(data.provider,'INTERNAL_TEST');assert.equal(data.channelId,internal.AD_REWARDS_TEST_CHANNEL_ID);assert.match(data.binding,/^[a-f0-9]{64}$/);assert(!JSON.stringify(data).includes(internal.AD_REWARDS_TEST_SECRET));
 const missing=fixture({settings:{...internal,AD_REWARDS_TEST_SECRET:undefined}});assert.equal((await missing.run()).provider,'NONE');assert.equal(missing.calls[0].payload.p_data.provider,'NONE');
 const adminReady=fixture({isAdmin:true,action:'state',query:'',settings:internal});assert.equal((await adminReady.run()).providerReady,true);
});

test('start challenge is allowlisted only on explicit AD start; status/close remove nonce, binding and foreign identity',async()=>{
 const challenge={protocol:'OP06_INTERNAL_TEST_V1',sessionId:sid,nonce:'a'.repeat(64),channelId:internal.AD_REWARDS_TEST_CHANNEL_ID,policyVersion:version,secret:'PRIVATE'},base={...marker,provider:'INTERNAL_TEST',session:{...session(),userId:uid,nonce:'PRIVATE',binding:'PRIVATE'},challenge,replayed:false};
 const f=fixture({action:'start',query:'',settings:internal,data:{episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()},result:base}),value=await f.run();assert.equal(value.challenge.nonce,'a'.repeat(64));assert.doesNotMatch(JSON.stringify(value),/PRIVATE|secret|binding|userId/);
 const status=fixture({action:'status',query:'sessionId='+sid,result:base});const read=await status.run();assert.equal(read.session.id,sid);assert(!('challenge'in read));assert.doesNotMatch(JSON.stringify(read),/PRIVATE|nonce|userId|binding/);
 const close=fixture({action:'close',query:'',data:{sessionId:sid,requestId:randomUUID()},result:base});assert.equal((await close.run()).replayed,false);assert.equal(close.calls[0].payload.p_action,'close');
 await reject({action:'status',query:'sessionId='+sid,result:{...base,session:{...session(),userId:other}}},'AD_REWARDS_TEST_UNAVAILABLE',1);
 const changed={...base,session:{...base.session,policyVersion:other},challenge:{...challenge,policyVersion:other}};
 await reject({action:'start',query:'',settings:internal,data:{episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()},result:changed},'AD_REWARDS_TEST_UNAVAILABLE',1);
 const replay=fixture({action:'start',query:'',settings:internal,data:{episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()},result:{...changed,replayed:true}});assert.equal((await replay.run()).session.policyVersion,other);
});

test('policy uses exact revision, ranges and UTC times without enabling a provider or accepting price/identity input',async()=>{
 const {id,...fields}=policy(),data={...fields,revision:'0',reason:'합성 보상 정책 변경',requestId:randomUUID()},f=fixture({isAdmin:true,action:'policy',query:'',data,result:{...state(),revision:'1',saved:true,replayed:false}});assert.equal((await f.run()).saved,true);assert.deepEqual(f.calls[0].payload,{p_user:uid,p_action:'admin-policy',p_data:data});
 for(const patch of [{revision:0},{rewardHours:0},{rewardHours:169},{sessionMinutes:31},{graceMinutes:61},{dailyLimit:101},{dailyLimit:1.1},{adEnabled:'true'},{campaignEnabled:true},{campaignStartsAt:'bad'},{campaignTitle:'x'.repeat(101)},{reason:'x'},{targetUserId:other},{points:100}])await reject({isAdmin:true,action:'policy',query:'',data:{...data,...patch}});
 const starts=new Date(Date.now()-1000).toISOString(),ends=new Date(Date.now()+86400000).toISOString();const utc=fixture({isAdmin:true,action:'policy',query:'',data:{...data,campaignEnabled:true,campaignTitle:'명시 무료 캠페인',campaignStartsAt:starts.replace('Z','+00:00'),campaignEndsAt:ends.replace('Z','+00:00')},result:{...state(),saved:true,replayed:false}});await utc.run();assert.equal(utc.calls[0].payload.p_data.campaignStartsAt,starts);
 const expired={...data,campaignEnabled:true,campaignTitle:'종료 후 정확한 정책 재시도',campaignStartsAt:new Date(Date.now()-3600000).toISOString(),campaignEndsAt:new Date(Date.now()-60000).toISOString()},replayed=fixture({isAdmin:true,action:'policy',query:'',data:expired,result:{...state(),policy:{...policy(),...expired},saved:true,replayed:true}});
 const receipt=await replayed.run();assert.equal(receipt.replayed,true);assert.equal(receipt.policy.campaignEndsAt,expired.campaignEndsAt);assert.deepEqual(replayed.calls[0].payload.p_data,expired);
 await reject({isAdmin:true,action:'policy',query:'',data:{...expired,requestId:randomUUID()},result:{error:'INVALID_REWARD_REQUEST',status:400}},'INVALID_REWARD_REQUEST',1);
});

test('explicit campaign claim works without any advertising or PG secret and never creates paid points',async()=>{
 const s={...session(),kind:'CAMPAIGN_FREE',status:'GRANTED',grant:{id:grantId,kind:'CAMPAIGN_FREE',expiresAt:'2026-11-03T00:00:00Z'}},f=fixture({action:'start',query:'',data:{episodeId:'3',kind:'CAMPAIGN_FREE',consent:true,policyVersion:version,requestId:randomUUID()},result:{...marker,session:s,replayed:false}});const value=await f.run();assert.equal(value.session.kind,'CAMPAIGN_FREE');assert.equal(value.session.grant.id,grantId);assert.equal(f.calls[0].name,'op06_rewards');assert.equal(f.calls[0].payload.p_data.provider,'NONE');assert.doesNotMatch(JSON.stringify(value),/balance|charged|paid|transaction/);
});

test('admin session pages use current Auth IDs with strict pagination while removing private proof fields',async()=>{
 const page={...marker,items:[{...session(),userId:other,nonce:'PRIVATE',binding:'PRIVATE'}],offset:0,limit:50,total:1,hasMore:false,nextOffset:null},f=fixture({isAdmin:true,action:'sessions',query:'',data:{status:'ALL',offset:0},result:page});const value=await f.run();assert.equal(value.items[0].userId,other);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|nonce|binding/);assert.equal(f.calls[0].payload.p_action,'admin-sessions');
 for(const data of [{offset:-1},{offset:'0'},{offset:100001},{status:'PAID'},{userId:other}])await reject({isAdmin:true,action:'sessions',query:'',data});
 for(const patch of [{hasMore:true},{total:55},{items:[{...session(),userId:'bad'}]},{limit:100}])await reject({isAdmin:true,action:'sessions',query:'',data:{},result:{...page,...patch}},'AD_REWARDS_TEST_UNAVAILABLE',1);
});

test('callback accepts only branded immutable verifier proof and projects no private challenge or identity',async()=>{
 let calls=0;const rpc=async(name,data)=>{calls++;assert.equal(name,'op06_apply_reward');assert.equal(Object.isFrozen(data.p_evidence),true);return {...marker,provider:'INTERNAL_TEST',session:{...session(),status:'GRANTED',grant:{id:grantId,kind:'AD_REWARD',expiresAt:'2026-11-03T00:00:00Z'},nonce:'PRIVATE',userId:other},challenge:{nonce:'PRIVATE'},replayed:false};};
 for(const proof of [null,evidence(),{...evidence(),binding:'a'.repeat(64),bodyDigest:'b'.repeat(64)}])await assert.rejects(adRewardsTestCallback({proof,rpc,fail}),e=>e.code==='INVALID_TEST_SIGNATURE');assert.equal(calls,0);
 const proof=await signedProof(evidence()),result=await adRewardsTestCallback({proof,rpc,fail});assert.equal(calls,1);assert.equal(result.session.status,'GRANTED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|nonce|binding|userId|challenge/);
 await assert.rejects(adRewardsTestCallback({proof:{...proof},rpc,fail}),e=>e.code==='INVALID_TEST_SIGNATURE');assert.equal(calls,1);
});

test('upstream error/DTO allowlists reject mismatched grants, fallback, identity and unknown secret errors',async()=>{
 for(const patch of [{mode:'LIVE'},{provider:'GOOGLE'},{episodeId:'4'},{adAvailable:true},{availability:'ALREADY_ACCESSIBLE'},{fallback:{...fallback,points:999999}},{policy:{...policy(),rewardHours:0}}])await reject({result:{...options(),...patch}},'AD_REWARDS_TEST_UNAVAILABLE',1);
 for(const result of [{error:'PRIVATE_SECRET',status:409},{error:'RATE_LIMITED',status:500}])await reject({result},'AD_REWARDS_TEST_UNAVAILABLE',1);
 await reject({result:{error:'IDEMPOTENCY_CONFLICT',status:409}},'IDEMPOTENCY_CONFLICT',1);
 for(const code of ['REWARD_POLICY_CHANGED','REWARD_SESSION_PENDING'])await reject({action:'start',query:'',data:{episodeId:'3',kind:'AD_REWARD',consent:true,policyVersion:version,requestId:randomUUID()},result:{error:code,status:409}},code,1);
 for(const patch of [{status:'GRANTED'},{grant:{id:grantId,kind:'AD_REWARD',expiresAt:'2026-11-03T00:00:00Z'}},{acceptUntil:'2026-11-02T00:01:00Z'},{kind:'POINTS'}])await reject({action:'status',query:'sessionId='+sid,result:{...marker,session:{...session(),...patch}}},'AD_REWARDS_TEST_UNAVAILABLE',1);
});

test('actual synthetic SQL receives signed proof once, preserves paid points and current-head rights, then expires only temporary access',async()=>{
 const {setup,reader:dbUser}=await import('./fixtures/op06-db.mjs'),f=await setup({openingPoints:1000});
 try{
  await f.rewardPolicy({adEnabled:true});const actor={userId:dbUser,reader:{status:'ACTIVE'}},auth={id:dbUser,email_confirmed_at:'2026-01-01T00:00:00Z'},rpc=async(name,data)=>(await f.db.query('select public.'+name+'($1'+(name==='op06_rewards'?', $2, $3':'')+') result',name==='op06_rewards'?[data.p_user,data.p_action,JSON.stringify(data.p_data)]:[JSON.stringify(data.p_evidence)])).rows[0].result;
  const run=(action,data={},post=false)=>adRewardsTestApi({request:new Request('https://site.test/api/v2/ad-rewards-test?'+new URLSearchParams({action,...(post?{}:data)}),{...(post?{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify(data)}:{})}),user:auth,actor,rpc,env:internal,fail});
  const episode=f.novel.episodes[2],before=await f.wallet(),choice=await run('options',{episodeId:episode.id});assert.equal(choice.adAvailable,true);assert.equal(choice.access,'LOCKED');
  const data={episodeId:episode.id,kind:'AD_REWARD',consent:true,policyVersion:choice.policy.id,requestId:randomUUID()},started=await run('start',data,true);assert.equal(started.session.status,'WAITING_EVIDENCE');assert.equal((await run('start',data,true)).session.id,started.session.id);
  const completedAt=new Date(Date.parse(started.session.createdAt)+1).toISOString(),proof=await signedProof({...evidence(),sessionId:started.session.id,nonce:started.challenge.nonce,channelId:started.challenge.channelId,completedAt});
  const applied=await adRewardsTestCallback({proof,rpc,fail}),replay=await adRewardsTestCallback({proof,rpc,fail});assert.equal(applied.session.status,'GRANTED');assert.equal(replay.replayed,true);assert.equal(replay.session.grant.id,applied.session.grant.id);
  assert.equal((await f.wallet()).totalPoints,before.totalPoints);assert.equal((await f.content(episode.id)).episodeId,episode.id);assert.equal((await f.db.query('select count(*)::int n from commerce.op06_grants')).rows[0].n,1);
  const read=await run('status',{sessionId:started.session.id});assert(!('challenge'in read));assert.doesNotMatch(JSON.stringify(read),/nonce|binding|userId/);
  const head=await f.replaceHead(episode);assert.equal((await f.content(episode.id)).versionId,head.versionId);
  await f.expireGrant(applied.session.grant.id);assert.equal((await f.content(episode.id)).error,'EPISODE_LOCKED');assert.equal((await f.wallet()).totalPoints,before.totalPoints);
  const comic=f.webtoon.episodes[2],oldOptions=await run('options',{episodeId:comic.id}),oldData={episodeId:comic.id,kind:'AD_REWARD',consent:true,policyVersion:oldOptions.policy.id,requestId:randomUUID()},pending=await run('start',oldData,true);
  await f.rewardPolicy({rewardHours:48});const newOptions=await run('options',{episodeId:comic.id});
  await assert.rejects(run('start',{...oldData,requestId:randomUUID()},true),e=>e.code==='REWARD_POLICY_CHANGED');
  await assert.rejects(run('start',{...oldData,policyVersion:newOptions.policy.id,requestId:randomUUID()},true),e=>e.code==='REWARD_SESSION_PENDING');
  const oldReplay=await run('start',oldData,true);assert.equal(oldReplay.replayed,true);assert.equal(oldReplay.session.id,pending.session.id);assert.equal(oldReplay.session.policyVersion,oldOptions.policy.id);assert.equal(oldReplay.session.rewardHours,24);
  const invalidPast=await f.rewardPolicy({campaignEnabled:true,campaignTitle:'종료된 신규 캠페인 거절',campaignStartsAt:new Date(Date.now()-3600000).toISOString(),campaignEndsAt:new Date(Date.now()-60000).toISOString()});assert.equal(invalidPast.error,'INVALID_REWARD_REQUEST');
 }finally{await f.db.close();}
});
