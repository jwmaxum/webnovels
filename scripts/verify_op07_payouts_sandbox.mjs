// Isolated TEST rehearsal. No environment/production DB, private identity, provider, bank or browser.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup,uuid} from './fixtures/op07-db.mjs';
const f=await setup();
try{
 const steps=[],c=await f.prepared();assert.equal(c.earning.sourceAmountKrw,100);assert.equal(c.earning.netKrw,70);assert.equal((await f.wallet()).totalPoints,9900);
 steps.push({action:'confirmed-topup-consumption',sourceAmountKrw:100,testAuthorNetKrw:70,topupFaceValueNotDoubleCounted:true});
 const requested=(await f.requestPayout(70)).payout;assert.equal((await f.payouts('summary')).summary.reservedKrw,70);assert.equal((await f.requestPayout(1)).error,'INSUFFICIENT_SETTLEMENT_BALANCE');
 const approved=(await f.transition('approve',requested)).payout;assert.equal(approved.status,'APPROVED');assert.equal(approved.evidence,null);assert.equal((await f.payouts('summary')).summary.paidKrw,0);
 steps.push({action:'atomic-request-and-approval',reservationKrw:70,approvedIsPaid:false,overdrawRejected:true});
 const dispatched=(await f.transition('begin',approved)).payout;assert.equal(dispatched.status,'UNKNOWN');assert.equal((await f.transition('begin',dispatched)).error,'PAYOUT_STATE_CONFLICT');await f.payee({ready:false});
 steps.push({action:'unknown-retains-reservation',externalTransferMade:false,newDispatchRejected:true,reservationKrw:70});
 const proof=f.evidence(dispatched),requestId=uuid(),paid=await f.transition('paid',dispatched,{...proof,requestId});assert.equal(paid.payout.status,'PAID');assert.equal((await f.transition('paid',dispatched,{...proof,requestId})).replayed,true);assert.equal(paid.summary.reservedKrw,0);assert.equal(paid.summary.paidKrw,70);
 steps.push({action:'frozen-payee-simulated-evidence',originalPayeeUsedAfterChange:true,outcome:'PAID',evidenceSource:'LOCAL_SIMULATED',duplicateMoneyMovement:0});
 const adjusted=await f.adminPayouts('adjust',{earningId:c.earning.id,amountKrw:20,reason:'지급 이후 합성 수익 조정',requestId:uuid()});assert.equal(adjusted.summary.debtKrw,20);assert.equal(adjusted.summary.availableKrw,0);assert.equal(adjusted.summary.paidKrw,70);
 steps.push({action:'postpayment-adjustment',originalPaidFactPreserved:true,debtKrw:20,availableKrw:0});
 const refund=await f.refund(c.order);assert.equal((await f.bankRefund(refund.order)).order.status,'REFUNDED');assert.equal((await f.payouts('summary')).summary.heldKrw,0);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'OWNED');
 steps.push({action:'unused-charge-refund',consumedEarningAndReaderRightPreserved:true,confirmedNetBeforeAdjustment:70});
 const tables=(await f.db.query("select tablename from pg_tables where schemaname='commerce' and tablename like 'op07_%' order by tablename")).rows.map(r=>r.tablename),functions=(await f.db.query("select n.nspname||'.'||p.proname name,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'op07_%' order by 1")).rows;
 const hashes={};for(const path of ['database/launch/019_points_test.sql','database/launch/020_topups_test.sql','database/launch/021_ad_rewards_test.sql','database/launch/022_author_payouts_test.sql','scripts/fixtures/op07-db.mjs','scripts/verify_op07_payouts_db.test.mjs','scripts/verify_op07_payouts_sandbox.mjs'])hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 const report={stage:'OP-07',checkedAt:new Date().toISOString(),result:'PASS',mode:'TEST',provenance:'LOCAL_SIMULATED',steps,finalSummary:(await f.payouts('summary')).summary,preservedRoutines:f.originalRoutines.length,preservedTables:f.preservedTables.length,tables,functions,evidence:hashes,operationalDatabaseApplied:false,operationalFlagsChanged:false,realPiiCollected:false,realTransferMade:false,providerCalled:false,browser:'NOT_RUN',nativePostgresMultiConnection:'NOT_RUN',limitations:['Single in-memory PGlite tests SQL invariants and transactions, not native multiconnection races','Simulated payee references and financial outcomes are not real bank/PG/advertising or tax evidence']};
 await mkdir('scratch/op07-sandbox',{recursive:true});await writeFile('scratch/op07-sandbox/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',steps:steps.length,tables:tables.length,functions:functions.length,finalSummary:report.finalSummary,realTransferMade:false,report:'scratch/op07-sandbox/report.json'}));
}finally{await f.db.close();}
