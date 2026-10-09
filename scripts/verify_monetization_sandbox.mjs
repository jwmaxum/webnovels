// Reproducible offline rehearsal: synthetic PGlite + injected provider, never env/local DB/network.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup,admin,merchant,uuid} from './fixtures/stage20-db.mjs';
import {episodeTossRequest} from '../server/providers/toss.mjs';
const f=await setup();
try {
 const p=await f.offer(),c=await f.create(p.episode),steps=[];let receipt;
 const provider=async(url,init)=>{
  if(url.endsWith('/confirm')){
   const data=JSON.parse(init.body);receipt={orderId:data.orderId,paymentKey:data.paymentKey,mId:merchant,
    totalAmount:data.amount,currency:'KRW',type:'NORMAL',method:'카드',status:'DONE',balanceAmount:data.amount,
    approvedAt:new Date().toISOString(),lastTransactionKey:'approval_'+uuid()};throw new Error('simulated lost approval response');
  }
  if(url.endsWith('/cancel')){
   const tx='refund_'+uuid();receipt={...receipt,status:'CANCELED',balanceAmount:0,lastTransactionKey:tx,
    cancels:[{transactionKey:tx,cancelAmount:receipt.totalAmount,cancelStatus:'DONE',canceledAt:new Date().toISOString()}]};
   throw new Error('simulated lost refund response');
  }
  return Response.json(receipt);
 };
 const execute=async(action,data={},user)=>{
  const r=await f.claim(c.order.id,action,data,user);assert.ok(r.transport,JSON.stringify(r));
  let proof;try{proof=await episodeTossRequest({operation:r.transport.operation,order:r.transport,
   secretKey:'test_sk_synthetic_fixture',reason:r.transport.reason},provider);}catch{proof={state:'UNKNOWN'};}
  const result=await f.apply(r.transport,proof);assert.ok(result.order,JSON.stringify(result));
  const balance=(await f.db.query('select coalesce(sum(gross_krw),0) gross,coalesce(sum(author_krw),0) author from commerce.ledger where order_id=$1',[c.order.id])).rows[0];
  steps.push({action,status:result.order.status,sandboxEntitled:result.order.sandboxEntitled,liveContentAccess:false,...balance});
 };
 await execute('claim-confirm');await execute('claim-query');
 await execute('claim-refund',{reason:'합성 전액 환불 시험'},admin);await execute('admin-query',{},admin);
 assert.deepEqual(steps.map(x=>x.status),['UNKNOWN','PAID','REFUND_UNKNOWN','REFUNDED']);
 assert.deepEqual(steps.map(x=>x.sandboxEntitled),[false,true,true,false]);assert.equal(steps.at(-1).gross,0);
 const evidence={};for(const path of ['database/authoring/016_paid_episodes.sql','server/paid-episode-api.mjs','server/providers/toss.mjs'])
  evidence[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 const report={schemaVersion:1,checkedAt:new Date().toISOString(),stage:20,provenance:'LOCAL_SIMULATED',
  liveRelease:'NO_GO',realDatabaseApplied:false,realProviderCalled:false,browserAcceptance:false,
  policy:'Synthetic fixture only; not approved business pricing or revenue allocation',steps,evidence,
  payout:{payableKrw:0,paidKrw:0,status:'NOT_AVAILABLE'},
  limitations:['Single PGlite instance is not real PostgreSQL concurrency acceptance','No live content grant, webhook or actual payment/payout launch']};
 await mkdir('scratch/stage20-sandbox',{recursive:true});await writeFile('scratch/stage20-sandbox/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:'PASS',provenance:report.provenance,steps:steps.map(x=>x.status),liveRelease:report.liveRelease,report:'scratch/stage20-sandbox/report.json'}));
} finally {await f.db.close();}
