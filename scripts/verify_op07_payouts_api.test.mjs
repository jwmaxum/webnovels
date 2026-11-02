import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {authorPayoutsTestApi,settlementsTestEnabled} from '../server/author-payouts-test-api.mjs';
import {createSecureApi} from '../server/secure-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {uid,other,pid,eid,marker,env,policy,summary,payee,author,admin,user,overview,state,payout,earning,page} from './fixtures/op07-api.mjs';
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
function app({isAdmin=false,action=isAdmin?'state':'summary',data={},query='',method,headers={},actor=isAdmin?admin:author,auth=user,result=isAdmin?state():overview(),settings=env}={}){
 const write=isAdmin||['request','cancel'].includes(action),verb=method||(write?'POST':'GET'),calls=[];
 const request=new Request('https://site.test/api/v2/'+(isAdmin?'admin':'creator')+'/payouts-test?action='+action+query,{method:verb,headers:{Origin:'https://site.test','Content-Type':'application/json',...headers},...(!['GET','HEAD'].includes(verb)?{body:typeof data==='string'?data:JSON.stringify(data)}:{})});
 return {calls,run:()=>authorPayoutsTestApi({request,env:settings,actor,user:auth,fail,rpc:async(name,args)=>{calls.push({name,args});return result;}})};
}
async function rejects(options,code,count=0){const a=app(options);await assert.rejects(a.run(),e=>e.code===code);assert.equal(a.calls.length,count);}
test('effective TEST gate fails closed before any Auth or DB on both routes',async()=>{
 assert.equal(settlementsTestEnabled(env),true);
 for(const patch of [{SETTLEMENTS_TEST_ENABLED:undefined},{SETTLEMENTS_TEST_ENABLED:true},{SETTLEMENTS_TEST_ENVIRONMENT:'LIVE'},{POINTS_TEST_ENABLED:'false'},{POINTS_TEST_PROVENANCE:'LIVE'},{FREE_BETA_ENABLED:'true'},{FREE_BETA_ENABLED:true},{P0_API_ENABLED:'false'}]){
  assert.equal(settlementsTestEnabled({...env,...patch}),false);
  for(const role of ['admin','creator']){let calls=0;const run=createSecureApi({fetchImpl:async()=>{calls++;throw Error('unexpected');}});const r=await run(new Request('https://site.test/api/v2/'+role+'/payouts-test?action=summary'),{...env,...patch});assert.equal(r.status,503);assert.equal((await r.json()).error,'SETTLEMENTS_TEST_NOT_ACTIVATED');assert.equal(calls,0);}
 }
});
test('verified Auth UUID and active owner/admin are mandatory',async()=>{
 for(const patch of [{actor:{...author,userId:other}},{auth:{...user,is_anonymous:true}},{auth:{...user,banned_until:'bad'}}])await rejects(patch,'INVALID_SESSION');
 await rejects({auth:{...user,email_confirmed_at:null}},'EMAIL_CONFIRMATION_REQUIRED');
 for(const value of [null,{id:'1',status:'SUSPENDED'},{id:'invalid',status:'APPROVED'}])await rejects({actor:{userId:uid,author:value}},'AUTHOR_REQUIRED');
 for(const value of [null,{role:'SUB_ADMIN',is_active:true},{role:'SUPER_ADMIN',is_active:false}])await rejects({isAdmin:true,actor:{userId:uid,admin:value}},'ADMIN_FORBIDDEN');
});
test('owner is derived only from actor, private extras are excluded at every DTO layer',async()=>{
 const a=app({result:{...overview(),secret:'PRIVATE',payee:{...payee,bankNumber:'PRIVATE'},summary:{...summary,password:'PRIVATE'}}}),r=await a.run();assert.equal(a.calls[0].args.p_user,uid);assert.equal(a.calls[0].name,'op07_payouts');assert.deepEqual(a.calls[0].args.p_data,{});assert.doesNotMatch(JSON.stringify(r),/PRIVATE|bankNumber|password/);
 await rejects({result:{...overview(),authorId:'2'}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 await rejects({action:'requests',result:page([payout({authorId:'2'})])},'SETTLEMENTS_TEST_UNAVAILABLE',1);
});
test('strict method query origin media size and forbidden fields prevent writes',async()=>{
 const base={action:'request',data:{amountKrw:500,policyVersion:pid,payeeRevision:'1',requestId:uid}};
 await rejects({...base,method:'GET'},'METHOD_NOT_ALLOWED');await rejects({...base,headers:{Origin:'https://evil.test'}},'ORIGIN_REQUIRED');await rejects({...base,headers:{'Content-Type':'text/plain'}},'JSON_REQUIRED');await rejects({...base,headers:{'Content-Encoding':'gzip'}},'UNSUPPORTED_ENCODING');await rejects({...base,data:' '.repeat(9000)},'BODY_TOO_LARGE');
 for(const field of ['authorId','accountNumber','bank','userId','status','paidAt','verified','livePayouts'])await rejects({...base,data:{...base.data,[field]:'forged'}},'INVALID_PAYOUT_REQUEST');
 for(const query of ['&action=request','&authorId=2','&offset=1&offset=2'])await rejects({query},'INVALID_QUERY');
 await rejects({isAdmin:true,action:'state',data:{authorId:'1'}},'INVALID_PAYOUT_REQUEST');
});
test('money revisions TEST references and UTC times are bounded',async()=>{
 for(const amountKrw of [0,-1,1.5,1000000001,'500'])await rejects({action:'request',data:{amountKrw,policyVersion:pid,payeeRevision:'1',requestId:uid}},'INVALID_PAYOUT_REQUEST');
 for(const revision of ['-1','01','9223372036854775808',1])await rejects({isAdmin:true,action:'approve',data:{payoutId:pid,revision,reason:'확인 사유',requestId:uid}},'INVALID_PAYOUT_REQUEST');
 for(const reference of ['real-bank-123','TEST-계좌','TEST-','TEST-x\n'])await rejects({isAdmin:true,action:'paid',data:{payoutId:pid,revision:'1',reason:'확인 사유',requestId:uid,reference,testReference:'TEST-user',amountKrw:500,paidAt:'2026-11-02T00:00:00Z'}},'TEST_REFERENCE_REQUIRED');
 await rejects({isAdmin:true,action:'paid',data:{payoutId:pid,revision:'1',reason:'확인 사유',requestId:uid,reference:'TEST-txn',testReference:'TEST-user',amountKrw:500,paidAt:'2026-02-31T00:00:00Z'}},'INVALID_PAYOUT_REQUEST');
});
test('author request and admin transitions forward exact input and enforce result owner/evidence',async()=>{
 const data={amountKrw:500,policyVersion:pid,payeeRevision:'1',requestId:randomUUID()},a=app({action:'request',data,result:{...marker,payout:payout(),summary,replayed:false}});assert.equal((await a.run()).payout.status,'REQUESTED');assert.deepEqual(a.calls[0].args.p_data,data);
 for(const action of ['approve','reject','begin']){const b=app({isAdmin:true,action,data:{payoutId:pid,revision:'1',reason:'정산 조건 확인',requestId:uid},result:{...marker,payout:payout({status:({approve:'APPROVED',reject:'REJECTED',begin:'UNKNOWN'})[action],dispatchedAt:action==='begin'?'2026-11-02T00:00:00Z':null}),summary,replayed:true}});await b.run();assert.equal(b.calls[0].args.p_action,'admin-'+action);}
 await rejects({isAdmin:true,action:'detail',data:{payoutId:pid},result:{...marker,payout:payout({id:other})}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 const ev={outcome:'PAID',reference:'TEST-txn',testReference:payee.testReference,amountKrw:500,occurredAt:'2026-11-02T01:00:00Z',source:'LOCAL_SIMULATED'};
 for(const patch of [{amountKrw:400},{testReference:'TEST-other'},{source:'BANK_LIVE'}])await rejects({isAdmin:true,action:'detail',data:{payoutId:pid},result:{...marker,payout:payout({status:'PAID',dispatchedAt:'2026-11-02T00:30:00Z',completedAt:'2026-11-02T01:00:00Z',evidence:{...ev,...patch}})}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
});
test('earnings and policy projections validate money arithmetic and bounded pages',async()=>{
 const a=app({action:'earnings',result:page([earning({privateRaw:'PRIVATE'})])});assert.doesNotMatch(JSON.stringify(await a.run()),/PRIVATE/);
 for(const row of [earning({netKrw:800}),earning({availableNetKrw:-1}),earning({authorId:'2'}),earning({sourceAmountKrw:Number.MAX_SAFE_INTEGER+1})])await rejects({action:'earnings',result:page([row])},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 await rejects({action:'requests',result:{...page([]),total:51,nextOffset:50,hasMore:true}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 await rejects({isAdmin:true,result:{...state(),policy:{...policy,authorBps:10001}}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
});
test('runtime/static capability exposes only effective boolean',async()=>{
 for(const [patch,expected]of [[{},true],[{SETTLEMENTS_TEST_ENABLED:undefined},false],[{FREE_BETA_ENABLED:'true'},false],[{SETTLEMENTS_TEST_ENVIRONMENT:'LIVE'},false]]){const c={window:{}};vm.runInNewContext(await onRequestGet({env:{...env,...patch}}).text(),c);assert.equal(c.window.WEBNOVELS_CONFIG.settlementsTestEnabled,expected);}
 const c={window:{}};vm.runInNewContext(readFileSync(new URL('../public/supabase-public-config.js',import.meta.url),'utf8'),c);assert.equal(c.window.WEBNOVELS_CONFIG.settlementsTestEnabled,false);
});
test('gateway derives actor and owner, sends only RPC payload, returns no-store',async()=>{
 const calls=[],run=createSecureApi({fetchImpl:async(url,init)=>{const u=new URL(url);assert.equal(u.origin,'https://synthetic.supabase.co');calls.push({path:u.pathname,data:init.body?JSON.parse(init.body):null});if(u.pathname==='/auth/v1/user')return Response.json(user);if(u.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);if(u.pathname.endsWith('/launch_account_actor'))return Response.json(author);if(u.pathname.endsWith('/op07_payouts'))return Response.json(overview());assert.fail('unexpected remote');}});
 const r=await run(new Request('https://site.test/api/v2/creator/payouts-test?action=summary',{headers:{Authorization:'Bearer synthetic.jwt.token'}}),env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).authorId,'1');assert.equal(calls.at(-1).data.p_user,uid);
});
test('canonical SQL business conflicts retain their status and do not become unknown server errors',async()=>{
 for(const code of ['PAYOUT_POLICY_CHANGED','PAYOUT_POLICY_DISABLED','SOURCE_NOT_PAYABLE','ADJUSTMENT_LIMIT','ADJUSTMENT_EXCEEDS_EARNING','INSUFFICIENT_SETTLEMENT_BALANCE','PAYOUT_STATE_CONFLICT','AUTHOR_NOT_PAYABLE','SETTLEMENT_HOLD','PAYOUT_PROOF_MISMATCH','PAYOUT_EVIDENCE_CONFLICT'])await rejects({result:{error:code,status:409}},code,1);
 await rejects({result:{error:'SQL_RAW_PRIVATE',status:409}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
});
test('admin-filtered rows and request snapshot cannot drift to another author or policy',async()=>{
 await rejects({isAdmin:true,action:'requests',data:{authorId:'2'},result:page([payout()])},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 await rejects({isAdmin:true,action:'earnings',data:{authorId:'2'},result:page([earning()])},'SETTLEMENTS_TEST_UNAVAILABLE',1);
 await rejects({action:'request',data:{amountKrw:500,policyVersion:pid,payeeRevision:'1',requestId:uid},result:{...marker,payout:payout({policyVersion:other}),summary,replayed:false}},'SETTLEMENTS_TEST_UNAVAILABLE',1);
});
