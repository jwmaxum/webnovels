import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setup} from './fixtures/stage17-db.mjs';
import {stage16Catalog} from '../server/stage16-api.mjs';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
let db;
const version = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const newer = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
before(async () => {
  ({db} = await setup());
  await db.exec(await read('database/authoring/015_webtoon.sql'));
  // Exercise the explicit RPC grants without relying on Supabase defaults.
  await db.exec('alter default privileges revoke execute on functions from public');
  const migration = await read('database/authoring/032_reader_catalog_localization.sql');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`
    insert into works(id,author_id,status,rating,title,description,genre,tags,published_at)
     values (30,1,'PUBLISHED','ALL','원제 30','공개 소개',array['판타지'],array['성장'],now()-interval '2 days'),
      (31,1,'PUBLISHED','ALL','원제 31','공개 소개',array['판타지'],array['성장'],now()-interval '2 days'),
      (32,1,'PUBLISHED','AGE_19','비공개 번역 원제','숨긴 소개',array['판타지'],array['성장'],now()-interval '2 days');
    insert into authoring.work_state(work_id,author_id,visibility) values (30,1,'PUBLIC'),(31,1,'PUBLIC'),(32,1,'PUBLIC');
    insert into episodes(id,work_id,episode_number,title,content,image_urls,status,is_free,access_policy)
     values (301,30,1,'원문 1화','비밀 본문','[]','PUBLISHED',true,'FREE'),
      (302,30,2,'원문 2화','유료 본문','[]','PUBLISHED',false,'PAID');
    insert into authoring.publication_versions(id,episode_id,work_id,title,content)
     values ('${version}',301,30,'원문 1화','비밀 본문'),('${newer}',301,30,'수정 원문','새 본문'),
      ('11111111-1111-4111-8111-111111111111',302,30,'원문 2화','유료 본문');
    insert into authoring.publication_heads(episode_id,version_id,published_at)
     values(301,'${version}',now()-interval '1 day'),(302,'11111111-1111-4111-8111-111111111111',now()-interval '1 day');
    insert into authoring.reader_work_translations(work_id,locale,source_locale,source_title,source_description,title,description,keywords,approval_ref)
     select id,'ja','ko',title,description,'銀河冒険 '||id,'承認済み紹介',array['ＡＢＣ','100%_'],'review:fixture'
     from works where id in (30,31,32);
    insert into authoring.reader_work_translations(work_id,locale,source_locale,source_title,source_description,title,approval_ref)
     select id,'zh-Hans','ko',title,description,'星际冒险','review:fixture' from works where id=30;
    insert into authoring.reader_episode_translations(episode_id,version_id,locale,source_locale,title,approval_ref)
     values(301,'${version}','ja','ko','第一話','review:fixture'),
      (302,'11111111-1111-4111-8111-111111111111','ja','ko','有料話','review:fixture');
  `);
});
after(async () => db?.close());
const row = async (sql, values) => (await db.query(sql, values)).rows[0]?.value;
const translations = (locale, works, episodes) => row('select public.reader_catalog_translations($1,$2,$3,true) value', [locale, works, episodes]);
const search = (locale, q, extra = {}) => row('select public.reader_catalog_localized_search($1,$2,true) value', [locale,
  JSON.stringify({q, sort:'episodes', type:'NOVEL', genre:'ALL', status:'ALL', rating:'ALL', epRange:'ALL', tags:[], limit:24, ...extra})]);

test('localized search uses literal native-script and folded matches before stable page limits', async () => {
  assert.deepEqual((await search('ja','冒険')).works.map(work => work.id), ['30','31']);
  assert.deepEqual((await search('ja','abc')).works.map(work => work.id), ['30','31']);
  assert.deepEqual((await search('ja','%_')).works.map(work => work.id), ['30','31']);
  assert.deepEqual((await search('ja','第一話')).works.map(work => work.id), ['30']);
  assert.deepEqual((await search('ja','有料話')).works, []);
  assert.deepEqual((await search('zh-Hans','际冒')).works.map(work => work.id), ['30']);
  assert.deepEqual((await search('en','冒険')).works, []);
  assert.deepEqual((await search('en','원제 30')).works.map(work => work.id), ['30']);
  assert.deepEqual((await search('ja','冒険',{genre:'무협'})).works, []);
  assert.deepEqual((await search('ja','冒険',{tags:['growth']})).works.map(work => work.id), ['30','31']);
  const first = await search('ja','冒険',{limit:1});
  assert.deepEqual(first.works.map(work => work.id), ['30']);
  const second = await search('ja','冒険',{limit:1,cursor:first.nextCursor,asOf:first.asOf});
  assert.deepEqual(second.works.map(work => work.id), ['31']);
  assert.equal(second.nextCursor, null);
});

test('metadata RPC exposes only public current-head approvals through service-role execution', async () => {
  for (const role of ['anon','authenticated','service_role']) {
    await db.exec('set role ' + role);
    try {
      await assert.rejects(db.query('select * from authoring.reader_work_translations'), /permission denied/);
      await assert.rejects(db.query('select * from authoring.reader_episode_translations'), /permission denied/);
      if (role !== 'service_role') {
        await assert.rejects(translations('ja',['30'],['301']), /permission denied/);
        await assert.rejects(search('ja','冒険'), /permission denied/);
      } else {
        const result = await translations('ja',['30','32'],['301','302']);
        assert.deepEqual(result.works.map(work => work.id), ['30']);
        assert.deepEqual(result.episodes.map(episode => episode.id), ['301']);
        assert.equal(result.episodes[0].versionId,version);
        assert.doesNotMatch(JSON.stringify(result), /review:fixture|비밀 본문|유료 본문/);
      }
    } finally { await db.exec('reset role'); }
  }
  await db.exec("update works set published_at=now()+interval '1 day' where id=30");
  assert.deepEqual(await translations('ja',['30'],['301']), {works:[],episodes:[]});
  await db.exec("update works set published_at=now()-interval '2 days' where id=30");
  await db.query('update works set description=$1 where id=30', ['수정된 소개']);
  await db.query('update authoring.publication_heads set version_id=$1 where episode_id=301', [newer]);
  assert.deepEqual(await translations('ja',['30'],['301']), {works:[],episodes:[]});
  assert.deepEqual((await search('ja','冒険')).works.map(work => work.id), ['31']);
  assert.deepEqual((await search('ja','第一話')).works, []);
});

const ranking = {periodDays:7,minSample:5,asOf:new Date().toISOString(),metric:'uniqueReaders'};
const work = {id:'30',title:'원제',description:'원문 소개',author:'작가',content_type:'NOVEL',status:'PUBLISHED',rating:'ALL'};
const settings = {AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',READER_DISCOVERY_ENABLED:'true'};
const fail = (status, code) => { throw Object.assign(Error(code),{status,code}); };
const path = query => new URL('https://example.test/api/v2/catalog?' + query);
const mock = {
  'rpc/stage16_catalog': {work,works:[work],ranking,nextCursor:{key:'1',id:work.id}},
  'rpc/reader_catalog_localized_search': {works:[work],ranking,nextCursor:{key:'1',id:work.id}},
  'rpc/reader_catalog_translations': {works:[{id:'30',locale:'ja',sourceLocale:'ko',sourceTitle:work.title,
    sourceDescription:work.description,title:'銀河冒険',description:'承認済み紹介',approvalRef:'private'}],episodes:[]}
};
async function request(query, enabled) {
  const calls = [];
  const result = await stage16Catalog({url:path(query),env:{...settings,READER_METADATA_LOCALIZATION_ENABLED:enabled?'true':'false'},fail,
    db:async (route,_params,options) => { calls.push({route,options});return mock[route]; }});
  return {result,calls};
}

test('catalog locale is allowlisted, cursor-bound, additive, and safe without database rollout', async () => {
  for (const query of ['action=list&locale=fr','action=list&locale=','action=list&locale=ko&locale=en']) {
    await assert.rejects(request(query,true),{status:400});
  }
  const fallback = await request('action=list&locale=ja&q=원제',false);
  assert.deepEqual(fallback.calls.map(call=>call.route), ['rpc/stage16_catalog']);
  assert.equal(fallback.calls[0].options.body.p_query.locale,undefined);

  const arabic = await request('action=list&locale=ar&q=원제',true);
  assert.deepEqual(arabic.calls.map(call=>call.route), fallback.calls.map(call=>call.route));
  assert.equal(arabic.result.works[0].title,work.title);
  assert.equal(arabic.result.works[0].localization,undefined);
  const arabicDetail = await request('action=work&workId=30&locale=ar',true);
  assert(!arabicDetail.calls.some(call=>call.route.includes('reader_catalog_translations')));
  assert.equal(fallback.result.works[0].title,work.title);
  const localized = await request('action=list&locale=ja&q=冒険',true);
  assert.deepEqual(localized.calls.map(call=>call.route),['rpc/reader_catalog_localized_search','rpc/reader_catalog_translations']);
  assert.deepEqual(localized.result.works[0].localization,{locale:'ja',sourceLocale:'ko',title:'銀河冒険'});
  assert.equal(localized.result.works[0].title,work.title);
  assert.equal(localized.result.works[0].description,undefined);
  const detail = await request('action=work&workId=30&locale=ja',true);
  assert.equal(detail.result.work.description,work.description);
  assert.equal(detail.result.work.localization.title,'銀河冒険');
  assert.equal(detail.result.work.localization.description,'承認済み紹介');
  const suffix = '&q=冒険&cursor=' + localized.result.nextCursor;
  await request('action=list&locale=ja'+suffix,true);
  await assert.rejects(request('action=list&locale=en'+suffix,true),{code:'INVALID_CURSOR'});
  await assert.rejects(request('action=list'+suffix,true),{code:'INVALID_CURSOR'});
  await assert.rejects(request('action=list&locale=ja'+suffix,false),{code:'INVALID_CURSOR'});
  const korean = await request('action=list&q=원제',true);
  await request('action=list&locale=ko&q=원제&cursor='+korean.result.nextCursor,true);
});

test('a slow earlier browser locale cannot be remembered under the newly selected locale', async () => {
  let locale = 'ja', respond;
  const remembered = [], queries = [];
  const context = {URLSearchParams, WEBNOVELS_CONFIG:{readerDiscoveryEnabled:true},
    ReaderI18n:{locale:()=>locale,rememberWork:(item, requested)=>remembered.push([item.id,requested])},
    fetch: (url) => {queries.push(url);return new Promise(resolve=>{respond=resolve;});}};
  context.window = context;
  vm.runInNewContext(await read('public/js/reader/reader-catalog.js'), context);
  const reading = context.ReaderCatalog.work('30');
  locale = 'en';
  respond(Response.json({work}));
  await reading;
  assert.match(queries[0], /locale=ja/);
  assert.deepEqual(remembered, [['30','ja']]);
});
