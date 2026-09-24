import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('administrator proxy authoring controls and direct writer exports are removed',async()=>{
  const [html,admin,bridge,creator]=await Promise.all([
    read('public/index.html'),read('public/js/admin/admin.js'),
    read('public/supabase-admin.js'),read('public/js/creator/creator.js')]);
  for(const name of ['modalAdminCreateWork','modalAdminCreateEpisode','modalAdminEpisodeDetail',
    'openAdminCreateWorkModal','openAdminCreateEpisodeModal','openAdminEpisodeDetailModal',
    'handleBulkEpisodeFree','handleBulkEpisodeDelete','handleBulkWorkStatus','handleBulkWorkDelete'])
    assert.doesNotMatch(html+'\n'+admin,new RegExp(name));
  for(const name of ['createWorkInDB','createEpisodeInDB','updateEpisodeSetting',
    'deleteEpisodeFromDB','updateWorkAdminSetting','deleteWorkFromDB'])
    assert.doesNotMatch(bridge+'\n'+creator,new RegExp(name));
  assert.match(html,/id="adminOperationsShell"/);
  assert.match(html,/js\/admin\/admin-operations\.js/);
  assert.match(html,/js\/core\/appeals\.js/);
  assert.match(html,/id="readerAppeals"/);
  for(const id of ['workSummaryTotalCount','workSummaryOngoingCount','workSummaryActionCount',
    'workSummaryCompletedCount'])assert.match(html,new RegExp(`id="${id}">-<`));
});

test('retired business controls and legacy action queue cannot issue browser writes',async()=>{
  const [html,admin,bridge]=await Promise.all([
    read('public/index.html'),read('public/js/admin/admin.js'),read('public/supabase-admin.js')]);
  for(const tab of ['admgmt','revenue','settlements','fanmeeting','goods','events','analytics','actionqueue'])
    assert.doesNotMatch(html,new RegExp(`id="adminTab-${tab}"|data-subtab="${tab}"`));
  for(const name of ['loadSettlementsList','handleRevenueCalculation','handleRevenueConfirm',
    'handleApproveSettlement','handleActionQueueItem','handleActionDismiss','loadAdminAnalytics'])
    assert.doesNotMatch(admin,new RegExp(`\\b${name}\\b`));
  for(const name of ['allocateRevenue','confirmRevenue','approveSettlementSecure','fetchPendingSettlements'])
    assert.doesNotMatch(bridge,new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(html,/자동화 엔진 가동중|최근 수익배분 이벤트/);
  assert.match(admin,/해당 사업 기능은 현재 제공되지 않습니다/);
});
