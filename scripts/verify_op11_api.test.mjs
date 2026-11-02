import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
import {manualPayoutWorkflowApi,manualPayoutWorkflowEnabled,projectManualWorkflow} from '../server/manual-payout-workflow-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import {setup,admin,reader,uuid} from './fixtures/op11-db.mjs';
import {env as baseEnv} from './fixtures/op07-api.mjs';
const env={...baseEnv,MANUAL_PAYOUT_WORKFLOW_ENABLED:'true'},origin='https://site.test';
test('manual workflow fails closed independently, and public config contains only readiness boolean',async()=>{
 const run=createSecureApi({fetchImpl:()=>assert.fail('disabled must not call a provider or DB')});
 for(const role of ['admin','creator']){const r=await run(new Request(origin+'/api/v2/'+role+'/payout-workflow'),baseEnv);assert.equal(r.status,503);}
 for(const patch of [{MANUAL_PAYOUT_WORKFLOW_ENABLED:'false'},{SETTLEMENTS_TEST_ENVIRONMENT:'LIVE'},{POINTS_TEST_PROVENANCE:'PROVIDER_TEST'}])assert.equal(manualPayoutWorkflowEnabled({...env,...patch}),false);
 const result=await onRequestGet({env:{...env,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_synthetic',PROVIDER_SETTINGS_MASTER_KEY:'PRIVATE_NOT_FOR_RESPONSE'}}).text();assert(result.includes('"manualPayoutWorkflowEnabled":true'));assert(!result.includes('PRIVATE_NOT_FOR_RESPONSE'));
});
test('gateway joins manual completion to original ledger once and never calls an external bank/provider',async()=>{
 const f=await setup();let userId=admin;const actor=()=>({userId,author:{id:f.author,status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}});
 try{
  const run=createSecureApi({fetchImpl:async(target,init={})=>{const url=new URL(target),body=init.body?JSON.parse(init.body):{};assert.equal(url.origin,'https://synthetic.supabase.co');
   if(url.pathname==='/auth/v1/user')return Response.json({id:userId,email_confirmed_at:'2026-01-01T00:00:00Z'});
   if(url.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);
   if(url.pathname.endsWith('/launch_account_actor'))return Response.json(actor());
   if(url.pathname.endsWith('/op11_manual_payout'))return Response.json(await f.flow(body.p_action,body.p_data,body.p_user,body.p_admin));assert.fail('Unexpected API path');
  }});
  async function call(action,data,role='admin',headers={}){const r=await run(new Request(origin+'/api/v2/'+role+'/payout-workflow',{method:'POST',headers:{Authorization:'Bearer synthetic.jwt.token',Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify({action,...data})}),env);return {status:r.status,body:await r.json()};}
  const p=await f.approve();assert.equal((await call('detail',{payoutId:p.id},'admin',{Origin:'https://other.test'})).status,403);
  const started=await call('start',f.change(p));assert.equal(started.status,200);assert.equal(started.body.workflow.status,'UNKNOWN');
  const proof=f.proof(started.body.workflow),paid=await call('complete',proof);assert.equal(paid.status,200);assert.equal(paid.body.workflow.status,'PAID');assert.equal((await call('complete',proof)).body.replayed,true);
  const author=await call('detail',{payoutId:p.id},'creator');assert.equal(author.status,200);assert.deepEqual(author.body.workflow.history,[]);assert(!JSON.stringify(author.body).includes(proof.documentReference));
  assert.equal((await call('complete',proof,'creator')).status,403);userId=reader;assert.equal((await call('detail',{payoutId:p.id},'creator')).status,404);
  assert.equal((await f.payouts('summary')).summary.paidKrw,70);
 }finally{await f.db.close();}
});
test('invalid forms, stale identity, methods, origin and oversize body fail before RPC',async()=>{
 const user={id:admin},actor={userId:admin,admin:{role:'SUPER_ADMIN',is_active:true}},rpc=()=>assert.fail('no RPC');
 const request=(data,options={})=>new Request(origin+'/api/v2/admin/payout-workflow'+(options.search||''),{method:options.method||'POST',headers:{Origin:options.origin||origin,'Content-Type':options.type||'application/json'},...(options.method==='GET'?{}:{body:typeof data==='string'?data:JSON.stringify(data)})});
 for(const req of [request({action:'toString'}),request({action:'detail',payoutId:uuid(),extra:'bad'}),request({action:'complete',payoutId:uuid()}),request({}, {origin:'https://bad.test'}),request({}, {method:'GET'}),request({}, {search:'?action=detail'}),request('x'.repeat(8193)),request('{bad'),request({}, {type:'text/plain'})])await assert.rejects(manualPayoutWorkflowApi({request:req,user,actor,env,rpc}),e=>[400,403,405,413,415].includes(e.status));
 await assert.rejects(manualPayoutWorkflowApi({request:request({action:'detail',payoutId:uuid()}),user,actor:{...actor,userId:reader},env,rpc}),e=>e.code==='INVALID_SESSION');
});
test('DTO excludes internal data and never accepts live or provider success as manual financial proof',()=>{
 const payoutId=uuid(),workflow={payoutId,method:'MANUAL',selected:true,status:'PAID',revision:'3',amountKrw:70,payeeReference:'TEST-target',history:[],proof:{provenance:'MANUAL_ATTESTED_TEST',outcome:'PAID',amountKrw:70,occurredAt:new Date().toISOString(),transactionReference:'TEST-private-transaction',documentReference:'TEST-private-document',envelope:'PRIVATE'},secret:'PRIVATE'};
 const result=projectManualWorkflow({mode:'TEST',livePayouts:false,workflow},{payoutId,admin:false});assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('TEST-private'));
 for(const changed of [{mode:'LIVE'},{livePayouts:true},{workflow:{...workflow,proof:{...workflow.proof,provenance:'PROVIDER_TEST'}}}])assert.throws(()=>projectManualWorkflow({mode:'TEST',livePayouts:false,workflow,...changed},{payoutId,admin:true}),/PAYOUT_WORKFLOW_UNAVAILABLE/);
});
