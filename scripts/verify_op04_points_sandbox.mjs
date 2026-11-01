// Reproducible synthetic TEST only. No .env, network, operational DB or provider.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setup,reader,otherReader,uuid} from './fixtures/op04-db.mjs';
const f=await setup();
try{
 const steps=[];
 for(const work of [f.novel,f.webtoon]){
  const list=await f.call('episodes',{workId:work.id});assert.deepEqual(list.items.map(row=>row.access),['MEMBER_FREE','MEMBER_FREE','LOCKED']);
  assert.equal((await f.content(work.episodes[0].id)).episodeId,work.episodes[0].id);assert.equal((await f.content(work.episodes[2].id)).error,'EPISODE_LOCKED');
  steps.push({action:'member-episodes',type:work.type,freeEpisodes:2,lockedEpisodePricePoints:100,metadataWithoutBody:true});
 }
 await f.credit(1000);const episode=f.novel.episodes[2],q=(await f.quote(episode.id)).quote,key=uuid();
 const paid=await f.purchase(q.id,key);assert.equal(paid.chargedPoints,100);
 const replay=await f.purchase(q.id,key);assert.equal(replay.replayed,true);
 const secondTab=await f.purchase(q.id,uuid());assert.equal(secondTab.chargedPoints,0);
 steps.push({action:'explicit-purchase-and-retry',chargedPoints:100,balancePoints:900,exactReceiptReplayed:true,differentRequestCharges:0});
 await f.policy('EPISODE',episode.id,250);const head=await f.replaceHead(episode);const reopened=await f.content(episode.id);assert.equal(reopened.versionId,head.versionId);assert.equal((await f.purchase(q.id)).chargedPoints,0);
 steps.push({action:'owned-after-price-and-head-change',stableEpisodeEntitlement:true,reopenedCurrentHead:true,additionalChargePoints:0});
 const comic=f.webtoon.episodes[2],cq=(await f.quote(comic.id)).quote;await f.purchase(cq.id);
 const panel=await f.panel(comic.id,comic.versionId,comic.panelId);assert.equal(panel.bucket,'authoring-webtoons');assert.equal((await f.panel(comic.id,comic.versionId,comic.panelId,'webp',otherReader)).error,'EPISODE_LOCKED');
 steps.push({action:'protected-webtoon-panel',memberAuthorized:true,crossAccountDenied:true,privatePathOnlyToServer:true});
 const wallet=await f.call('wallet');assert.equal(wallet.balancePoints,800);
 const ledger=(await f.db.query('select sum(delta_points)::integer points,count(*)::integer entries from commerce.op04_ledger where user_id=$1',[reader])).rows[0];assert.equal(ledger.points,wallet.balancePoints);
 const evidence={};for(const path of ['database/launch/019_points_test.sql','scripts/fixtures/op04-db.mjs'])evidence[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 const report={stage:'OP-04',checkedAt:new Date().toISOString(),mode:'TEST',provenance:'LOCAL_SIMULATED',result:'PASS',realDatabaseApplied:false,operationalFlagsChanged:false,realProviderCalled:false,realMoneyOrAuthorEarnings:false,browser:'NOT_RUN',postgresMultiConnectionConcurrency:'NOT_RUN',steps,finalWalletPoints:wallet.balancePoints,ledgerEntries:ledger.entries,ledgerReconciled:true,evidence,limitations:['Single PGlite instance verifies transaction invariants and replay, not real PostgreSQL parallel connections','No operational TEST data or LIVE payments, refunds, financial migration or production entitlement activation']};
 await mkdir('scratch/op04-sandbox',{recursive:true});await writeFile('scratch/op04-sandbox/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:'PASS',mode:'TEST',provenance:'LOCAL_SIMULATED',steps:steps.length,ledgerReconciled:true,realDatabaseApplied:false,report:'scratch/op04-sandbox/report.json'}));
}finally{await f.db.close();}
