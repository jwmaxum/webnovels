import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup as foundation,admin,reader,limited,otherReader,uuid} from './op05-db.mjs';
export {admin,reader,limited,otherReader,uuid};
export const sql=await readFile(new URL('../../database/launch/021_ad_rewards_test.sql',import.meta.url),'utf8');
export const provider={provider:'INTERNAL_TEST',channelId:'synthetic-op06-channel',binding:'a'.repeat(64)};
export async function setup({seed=true,openingPoints=0}={}){
 const f=await foundation({seed,openingPoints}),{db}=f;
 try{
  const routine=async signature=>(await db.query('select oid::text,prosrc,proowner::text,proconfig,proacl::text from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
  const originalBase=await routine('commerce.op05_points_base(uuid,text,jsonb)'),originalAccess=await routine('commerce.op04_access(uuid,bigint,integer,integer)'),originalWrapper=await routine('public.op04_points_test(uuid,text,jsonb)');
  const preservedTables=(await db.query("select tablename from pg_tables where schemaname='commerce' order by tablename")).rows.map(r=>r.tablename),snapshot={};
  for(const table of preservedTables)snapshot[table]=(await db.query('select to_jsonb(x) data from commerce.'+table+' x order by to_jsonb(x)::text')).rows.map(r=>r.data);
  await db.exec("set webnovels.ad_rewards_test_apply_verified='true'");await db.exec(sql);
  assert.deepEqual(await routine('commerce.op05_points_base(uuid,text,jsonb)'),originalBase);
  assert.equal((await routine('commerce.op04_access(uuid,bigint,integer,integer)')).oid,originalAccess.oid);
  const wrapper=await routine('public.op04_points_test(uuid,text,jsonb)');assert.equal(wrapper.oid,originalWrapper.oid);assert.equal(wrapper.proowner,originalWrapper.proowner);assert.deepEqual(wrapper.proconfig,originalWrapper.proconfig);assert.equal(wrapper.proacl,originalWrapper.proacl);
  for(const table of preservedTables)assert.deepEqual((await db.query('select to_jsonb(x) data from commerce.'+table+' x order by to_jsonb(x)::text')).rows.map(r=>r.data),snapshot[table]);
  const rewards=async(action,data={},user=reader)=>(await db.query('select public.op06_rewards($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
  const adminRewards=(action,data={})=>rewards('admin-'+action,data,admin);
  async function rewardPolicy(changes={}){
   const state=await adminRewards('state'),{id,...policy}=state.policy;
   return adminRewards('policy',{...policy,revision:state.revision,reason:'명시적 내부 광고 보상 TEST 정책',requestId:uuid(),...changes});
  }
  const options=(episodeId=f.novel?.episodes[2].id,config=provider,user=reader)=>rewards('options',{episodeId,...config},user);
  const start=async(episodeId=f.novel?.episodes[2].id,kind='AD_REWARD',changes={},user=reader)=>rewards('start',{episodeId,policyVersion:(await adminRewards('state')).policy.id,kind,consent:true,requestId:uuid(),...(kind==='AD_REWARD'?provider:{provider:'NONE',channelId:null,binding:null}),...changes},user);
  const closeReward=(sessionId,changes={},user=reader)=>rewards('close',{sessionId,requestId:uuid(),...changes},user);
  const evidence=(started,changes={})=>{const c=started.challenge;const value={protocol:'OP06_INTERNAL_TEST_V1',eventId:'synthetic-event-'+uuid(),sessionId:c.sessionId,nonce:c.nonce,channelId:c.channelId,outcome:'GRANTED',completedAt:started.session.createdAt.replace(/\+00:00$/,'Z'),reward:{type:'EPISODE_ACCESS',quantity:1},provider:'INTERNAL_TEST',binding:provider.binding,...changes};return {...value,bodyDigest:createHash('sha256').update(JSON.stringify(value)).digest('hex')};};
  const applyEvidence=async value=>(await db.query('select public.op06_apply_reward($1) result',[JSON.stringify(value)])).rows[0].result;
  const grantAd=async(episodeId=f.novel?.episodes[2].id,changes={})=>{const started=await start(episodeId);assert.ok(started.challenge,JSON.stringify(started));const proof=evidence(started,changes);const applied=await applyEvidence(proof);return {started,proof,applied};};
  async function expireGrant(grantId){
   // Synthetic aging only, not exposed through any runtime RPC.
   await db.exec('alter table commerce.op06_grants disable trigger op06_immutable');
   try{await db.query("update commerce.op06_grants set granted_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[grantId]);}finally{await db.exec('alter table commerce.op06_grants enable trigger op06_immutable');}
  }
  return {...f,rewards,adminRewards,rewardPolicy,options,start,closeReward,evidence,applyEvidence,grantAd,expireGrant,originalBase,originalAccess,originalWrapper,preservedTables,preservedSnapshot:snapshot};
 }catch(error){await db.close();throw error;}
}
