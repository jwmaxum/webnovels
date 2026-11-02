import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,admin,uuid} from './fixtures/op10-db.mjs';
import {sql} from './fixtures/op11-db.mjs';
test('upgrade preserves old rows/routines, adopts manual unknowns without resending and quarantines mixed paths',async()=>{
 const f=await setup(),db=f.db;
 try{
  await f.prepared();const a=(await f.transition('approve',(await f.requestPayout(35)).payout)).payout,b=(await f.transition('approve',(await f.requestPayout(35)).payout)).payout;
  const unknownA=(await f.transition('begin',a)).payout,cfg=await f.save();f.env.PAYOUT_PROVIDER_TEST_CONFIG_ID=cfg.configId;
  const external=await f.adminCall('prepare',{id:uuid(),sourceId:b.id,configId:cfg.configId,destination:'synthetic',scheduleType:'EXPRESS',payoutDate:null,transactionDescription:'TEST'});assert(external.job);assert((await f.claim(external.job)).claimed);
  const unknownB=(await f.transition('begin',b)).payout;
  const rows=(await db.query('select to_jsonb(t) v from commerce.op07_payouts t order by id')).rows,routines=(await db.query("select oid::text,prosrc,proacl::text,proconfig from pg_proc where proname like 'op07_%' or proname like 'op10_%' order by oid")).rows;
  await db.exec("set webnovels.manual_payout_workflow_apply_verified='true'");await db.exec(sql);
  assert.deepEqual((await db.query('select to_jsonb(t) v from commerce.op07_payouts t order by id')).rows,rows);assert.deepEqual((await db.query("select oid::text,prosrc,proacl::text,proconfig from pg_proc where proname like 'op07_%' or proname like 'op10_%' order by oid")).rows,routines);
  const call=async(action,p,data={})=>(await db.query('select public.op11_manual_payout($1,$2,$3,true) r',[admin,action,JSON.stringify({payoutId:p.id,...data})])).rows[0].r;
  const adopted=await call('start',unknownA,{revision:unknownA.revision,requestId:uuid(),reason:'이전 미확인 수동 내역 인수'});assert.equal(adopted.workflow.method,'MANUAL');assert.equal(adopted.workflow.revision,unknownA.revision);assert.equal(adopted.workflow.startedAt,unknownA.dispatchedAt);assert.equal(adopted.workflow.history[0].kind,'ADOPT');
  assert.equal((await call('detail',unknownB)).workflow.method,'LEGACY_REVIEW');assert.equal((await call('start',unknownB,{revision:unknownB.revision,requestId:uuid(),reason:'혼합된 이력 수동 전환 차단'})).error,'PAYOUT_METHOD_CONFLICT');
  await db.query("update commerce.op10_jobs set lease_until=now()-interval '1 minute' where id=$1",[external.job.id]);assert.equal((await f.claim(external.job)).claimed,false);assert((await f.claim(external.job,'claim-query')).claimed);
  assert.equal((await f.payouts('summary')).summary.reservedKrw,70);
 }finally{await db.close();}
});
