import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,admin,reader,limited,uuid,sql} from './fixtures/op10-db.mjs';
import {processPayoutTest,payoutProviderTestCallback,reconcileDuePayoutTests} from '../server/payout-provider-test-api.mjs';
import {encryptPayoutTestBody} from '../server/providers/payouts-toss-test.mjs';
let f,db;before(async()=>{f=await setup();db=f.db;});after(async()=>db?.close());
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
const receipt=(j,state='COMPLETED')=>({id:'synthetic-provider-id',refPayoutId:j.refPayoutId,destination:j.destination,scheduleType:j.scheduleType,amount:{currency:'KRW',value:j.amountKrw},transactionDescription:j.transactionDescription,requestedAt:new Date().toISOString(),status:state});
async function signed(j,eventId='synthetic-event',changed={}){
 const body=JSON.stringify({eventType:'payout.changed',eventId,entityType:'payout',entityBody:receipt(j),...changed}),time=new Date().toISOString();
 const key=await crypto.subtle.importKey('raw',Buffer.from(f.values.webhookKeyBase64,'base64'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,Buffer.from(body+':'+time))).toString('base64');
 return new Request('https://synthetic.example/api/v2/payout-provider-test/callback?configId='+j.configId,{method:'POST',headers:{'content-type':'application/json','tosspayments-webhook-transmission-time':time,'tosspayments-webhook-signature':'v1:'+signature},body});
}
test('migration is guarded, OP07 routines unchanged, every private table denies actual roles',async()=>{
 assert.deepEqual((await db.query("select oid::text,prosrc,proacl::text,proconfig from pg_proc where proname like 'op07_%' order by oid")).rows,f.op07Routines);
 const tables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='commerce' and tablename like 'op10_%'")).rows;assert.equal(tables.length,7);
 for(const role of ['anon','authenticated','service_role']){
  for(const t of tables){assert(t.rowsecurity);for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'commerce.'+t.tablename,privilege])).rows[0].allowed,false);
   await db.exec('savepoint acl;set role '+role);await assert.rejects(db.query('select * from commerce.'+t.tablename),/permission denied/);await db.exec('rollback to acl;release acl');}
  await db.exec('savepoint acl;set role '+role);if(role==='service_role')assert.equal((await f.adminCall('state')).revision,'0');else await assert.rejects(f.adminCall('state'),/permission denied/);await db.exec('rollback to acl;release acl');
  await db.exec('savepoint acl;set role '+role);if(role==='service_role')assert.deepEqual((await f.runtime('due')).items,[]);else await assert.rejects(f.runtime('due'),/permission denied/);await db.exec('rollback to acl;release acl');
 }
 await db.exec('savepoint guard');await assert.rejects(db.exec(sql),/Reviewed OP10/);await db.exec('rollback to guard;release guard');
});
test('current verified SUPER_ADMIN and strict input are required; writes rate limited',async()=>{
 for(const user of [reader,limited])assert.equal((await f.adminCall('state',{},user)).error,'ADMIN_FORBIDDEN');
 for(const [action,data]of [['state',{extra:true}],['prepare',{id:'fake'}],['list',{offset:-1}],['save',{revision:0}],['other',{}]])assert.equal((await f.adminCall(action,data)).error,'INVALID_PAYOUT_REQUEST');
 const used=(await db.query('select writes from commerce.op10_limits where actor_id=$1',[admin])).rows[0]?.writes||0;
 for(let i=used;i<5;i++)assert.equal((await f.adminCall('attempt')).ok,true);assert.equal((await f.adminCall('attempt')).error,'RATE_LIMITED');
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);assert.equal((await f.adminCall('state')).error,'ADMIN_FORBIDDEN');
});
test('immutable config versions use CAS; prepared requests bind exact source and destination',async()=>{
 const {job,data}=await f.prepare();assert(job);assert.equal(job.providerMode,'PROVIDER_TEST');assert.equal(job.ledgerApplyAllowed,false);
 assert.equal((await f.adminCall('prepare',data)).job.id,job.id);
 assert.equal((await f.adminCall('prepare',{...data,destination:'different'})).error,'CONFLICT');
 assert.equal((await f.adminCall('prepare',{...data,id:uuid()})).error,'CONFLICT');
 const old=await f.runtime('config',{configId:job.configId}),saved=await f.save({secretKey:'test_sk_rotated_synthetic'});assert.notEqual(saved.configId,job.configId);
 assert.deepEqual(await f.runtime('config',{configId:job.configId}),old);
 assert.equal((await f.adminCall('save',{revision:'0',merchantId:'synthetic',envelope:{}})).error,'CONFLICT');
 await db.exec('savepoint frozen');await assert.rejects(db.query("update commerce.op10_jobs set destination='changed' where id=$1",[job.id]),/OP10_FROZEN/);await db.exec('rollback to frozen;release frozen');
 await db.exec('savepoint frozen');await assert.rejects(db.exec("update commerce.op10_configs set merchant_id='changed'"),/IMMUTABLE/);await db.exec('rollback to frozen;release frozen');
});
test('source change, unreviewed config, or revoked admin blocks dispatch before network',async()=>{
 const {job,source}=await f.prepare();assert.equal((await f.runtime('claim-create',{id:job.id,actorId:admin,reviewedConfigId:uuid()})).error,'CONFIG_NOT_REVIEWED');
 assert.equal((await f.runtime('claim-create',{id:job.id,actorId:reader,reviewedConfigId:job.configId})).error,'ADMIN_FORBIDDEN');
 await f.transition('reject',source);assert.equal((await f.claim(job)).error,'SOURCE_NOT_READY');
 assert.equal((await f.adminCall('detail',{id:job.id})).job.state,'READY');
});
test('lost create response stays UNKNOWN; retry never sends a second POST; bounded scan reconciles',async()=>{
 const {job,source}=await f.prepare();let posts=0;
 const missing=async()=>{posts++;throw Error('lost response');};
 const args={id:job.id,operation:'create',actorId:admin,env:f.env,rpc:f.rpc,fetchImpl:missing};
 assert.equal((await processPayoutTest(args)).job.state,'UNKNOWN');assert.equal((await processPayoutTest(args)).claimed,false);assert.equal(posts,1);
 const calls=[],fetcher=async(url,init)=>{calls.push(init.method);assert.equal(init.method,'GET');return Response.json(url.includes('?')?{entityType:'payout-list',entityBody:{hasMore:false,items:[receipt(job)]}}:{entityType:'payout',entityBody:receipt(job)});};
 assert.equal((await processPayoutTest({...args,operation:'query',fetchImpl:fetcher})).job.state,'COMPLETED');assert.equal(calls.length,2);
 assert.equal((await f.payouts('request-detail',{payoutId:source.id})).payout.status,'APPROVED');assert.equal((await f.payouts('summary')).summary.paidKrw,0);
 assert.equal((await f.payouts('summary')).summary.reservedKrw,70);
});
test('claim crash and expiry permit query only; stale observation cannot overwrite a newer lease',async()=>{
 const {job}=await f.prepare(),claim=await f.claim(job);assert(claim.claimed);
 await db.query("update commerce.op10_jobs set lease_until=now()-interval '1 minute' where id=$1",[job.id]);
 assert.equal((await f.claim(job)).claimed,false);const next=await f.claim(job,'claim-query');assert(next.claimed);
 assert.equal((await f.runtime('observe',{id:job.id,leaseId:claim.leaseId,observation:{state:'UNKNOWN'}})).error,'CONFLICT');
 await f.runtime('observe',{id:job.id,leaseId:next.leaseId,observation:{state:'UNKNOWN'}});
 await f.runtime('observe',{id:job.id,leaseId:next.leaseId,observation:{state:'UNKNOWN'}});
 assert.equal((await db.query('select count(*)::int n from commerce.op10_evidence')).rows[0].n,1);
});
test('signed webhook only queues requery; event replay dedups and conflicting body is rejected',async()=>{
 const {job}=await f.prepare();await processPayoutTest({id:job.id,actorId:admin,operation:'create',env:f.env,rpc:f.rpc,fetchImpl:async()=>{throw Error();}});
 const request=await signed(job);assert.deepEqual(await payoutProviderTestCallback({request:request.clone(),env:f.env,rpc:f.rpc}),{accepted:true});
 assert.deepEqual(await payoutProviderTestCallback({request:request.clone(),env:f.env,rpc:f.rpc}),{accepted:true});
 assert.equal((await db.query('select count(*)::int n from commerce.op10_inbox')).rows[0].n,1);
 assert.equal((await f.adminCall('detail',{id:job.id})).job.state,'UNKNOWN');
 await assert.rejects(payoutProviderTestCallback({request:await signed(job,'synthetic-event',{version:'changed'}),env:f.env,rpc:f.rpc}),e=>e.code==='CONFLICT');
 const report=await reconcileDuePayoutTests({env:f.env,rpc:f.rpc,fetchImpl:async url=>Response.json(url.includes('?')?{entityType:'payout-list',entityBody:{hasMore:false,items:[receipt(job)]}}:{entityType:'payout',entityBody:receipt(job)})});assert.equal(report.processed,1);
 assert.equal((await f.adminCall('detail',{id:job.id})).job.state,'COMPLETED');
});
test('pinned config survives secret rotation; mismatched provider receipt cannot complete',async()=>{
 const {job}=await f.prepare();await f.save({securityKey:'f'.repeat(64)});
 const r=await processPayoutTest({id:job.id,actorId:admin,operation:'create',env:f.env,rpc:f.rpc,fetchImpl:async()=>new Response(await encryptPayoutTestBody({entityType:'payout-list',entityBody:{items:[{...receipt(job),amount:{currency:'KRW',value:999}}]}},f.values.securityKey))});
 assert.equal(r.job.state,'UNKNOWN');
});
test('query evidence ceiling stops automatic polling without releasing the source reservation',async()=>{
 const {job,source}=await f.prepare();await f.claim(job);
 await db.query("update commerce.op10_jobs set lease_until=now()-interval '1 minute',next_query_at=now() where id=$1",[job.id]);
 await db.query("insert into commerce.op10_evidence(job_id,lease_id,observation) select $1,gen_random_uuid(),'{\"state\":\"UNKNOWN\"}'::jsonb from generate_series(1,200)",[job.id]);
 const claim=await f.claim(job,'claim-query');assert.equal(claim.claimed,false);assert.equal(claim.reviewRequired,true);
 assert.equal((await f.adminCall('detail',{id:job.id})).job.state,'REVIEW');assert.deepEqual((await f.runtime('due')).items,[]);
 assert.equal((await f.payouts('request-detail',{payoutId:source.id})).payout.status,'APPROVED');
});
