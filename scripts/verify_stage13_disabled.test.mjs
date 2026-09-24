import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [adapter, creator, reader, state] = await Promise.all([
  'public/supabase-admin.js', 'public/js/creator/creator.js', 'public/js/reader/reader.js',
  'public/js/core/state.js'
].map(read));

test('free catalog presentation excludes adult works and paid episodes', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(state, context);
  vm.runInContext(`SAMPLE_WORKS.push(
    {id:1,status:'PUBLISHED',rating:'AGE_19',episodes:[{status:'PUBLISHED',isFree:true}]},
    {id:2,status:'PUBLISHED',rating:'ALL',episodes:[
      {status:'PUBLISHED',isFree:true,accessPolicy:'FREE'},
      {status:'PUBLISHED',isFree:false,accessPolicy:'PAID'}]})`, context);
  const works = vm.runInContext('getPublishedWorks()', context);
  assert.equal(works.length, 1);
  assert.equal(works[0].id, 2);
  assert.equal(works[0].episodes.length, 1);
});

test('legacy monetization adapter cannot read or write revenue data from the browser', async () => {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null },
    addEventListener() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(adapter, context);
  context.dbTrap = { from() { assert.fail('direct revenue table access'); }, rpc() { assert.fail('direct revenue RPC'); } };
  vm.runInContext('supabaseClient = dbTrap', context);
  const api = context.WebNovelsAdmin;
  for (const name of ['recordEpisodeUnlock', 'unlockEpisodeWithAdSecure', 'requestSettlementSecure', 'supportCreator']) {
    const result = await api[name](1, 2, 3);
    assert.equal(result.success, false, name);
    assert.equal(result.error, 'MONETIZATION_NOT_ACTIVATED', name);
  }
  assert.equal(await api.logAdEvent(1, 2, 3), null);
  for (const name of ['fetchAuthorEarnings', 'fetchAuthorSettlements', 'fetchAuthorEarningLedger', 'fetchWorkTopSupporters']) {
    assert.equal((await api[name](1)).length, 0, name);
  }
  assert.equal(await api.fetchAuthorRevenueSummary(1), null);
});

test('creator settlement cannot use local identity, balance text, or old RPC', async () => {
  const messages = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    localStorage: { getItem() { assert.fail('local identity must not be read'); } },
    showToast: message => messages.push(message)
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(creator, context);
  assert.equal(context.handleAuthorSettlementReq, context.handleCreatorSettlementReq);
  const result = await context.handleCreatorSettlementReq(5000);
  assert.equal(result.success, false);
  assert.match(messages[0], /현재 사용할 수 없습니다/);
});

test('reader rejects paid and adult episodes before local verification or content lookup', async () => {
  const ast = ts.createSourceFile('reader.js', reader, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const assignment = ast.statements.find(node => ts.isExpressionStatement(node) &&
    node.getText(ast).startsWith('window.openReaderDirect = async function'));
  assert.ok(assignment);
  for (const work of [
    { id: 1, rating: 'ALL', genre: '판타지', episodes: [{ episodeNumber: 1, isFree: false }] },
    { id: 1, rating: 'AGE_19', genre: '성인', episodes: [{ episodeNumber: 1, isFree: true }] },
    { id: 1, rating: 'ADULT', genre: '판타지', episodes: [{ episodeNumber: 1, isFree: true }] },
    { id: 1, rating: 'ALL', genre: '판타지', episodes: [{ episodeNumber: 1, is_free: false, access_policy: 'PAID' }] }
  ]) {
    let toast = '';
    const context = {
      window: { WEBNOVELS_CONFIG: { authorPublishEnabled: false } },
      getPublishedWorks: () => [work],
      localStorage: { getItem() { assert.fail('local adult verification must not be read'); } },
      showToast: message => { toast = message; },
      document: { getElementById() { assert.fail('protected content view must not render'); } }
    };
    vm.createContext(context);
    vm.runInContext(assignment.getText(ast), context);
    await context.window.openReaderDirect(1, 1);
    assert.match(toast, /현재 사용할 수 없습니다/);
  }
});
