import {test} from 'node:test';
import assert from 'node:assert/strict';
import {growthApi,growthEnabled,validGrowthPolicy} from '../server/growth-api.mjs';
import {growthSeo} from '../server/growth-seo.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import worker from '../scheduler/worker.mjs';
import {config,admin,reader} from './fixtures/stage21-db.mjs';
const env={P0_API_ENABLED:'true',GROWTH_SERVICE_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',READER_DISCOVERY_ENABLED:'true',
 SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture',GROWTH_CANONICAL_ORIGIN:'https://example.test'};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const work={id:'35',title:'공개 작품',author:'필명',author_id:'1',genre:['판타지'],content_type:'NOVEL',status:'PUBLISHED',rating:'ALL',episode_count:1,reason:'RECENT_PUBLIC_SERIAL',content:'PRIVATE_MANUSCRIPT'};
function call(path,{data,method,headers={},override={},who={userId:reader,reader:{status:'ACTIVE'}},result={}}={}){
 const calls=[];return {calls,promise:growthApi({request:new Request('https://example.test'+path,{method:method||(data?'POST':'GET'),headers:{...(data?{origin:'https://example.test','content-type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env:{...env,...override},actor:async()=>who,
 db:async(table,q,init)=>{calls.push({table,init});return result;},readBody:r=>r.json(),fail})};
}
test('all growth gates fail closed and public config exposes only a false-by-default boolean',async()=>{
 for(const key of ['P0_API_ENABLED','GROWTH_SERVICE_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED']){
  assert.equal(growthEnabled({...env,[key]:'false'}),false);await assert.rejects(call('/api/v2/reader/growth',{override:{[key]:'false'}}).promise,e=>e.status===503);}
 const source=await onRequestGet({env:{SUPABASE_URL:env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',PRIVATE_TEST_VALUE:'do not leak'}}).text();
 assert.match(source,/"growthServiceEnabled":false/);assert.ok(!source.includes('do not leak'));
});
test('public feed excludes private metadata; authenticated writes bind the actor and exact origin',async()=>{
 const x=call('/api/v2/reader/growth?action=feed',{result:{works:[work],analyticsConsent:false}}),r=await x.promise;
 assert.equal(r.works[0].content,undefined);assert.equal(x.calls[0].init.body.p_user,null);assert.equal(r.measurement,'SERVER_PROVIDED_NOT_VIEWPORT');
 const y=call('/api/v2/reader/growth?action=feed',{data:{},result:{works:[work],analyticsConsent:true}});await y.promise;assert.equal(y.calls[0].init.body.p_user,reader);
 for(const headers of [{origin:'https://evil.test'},{origin:''}])await assert.rejects(call('/api/v2/reader/growth?action=reset',{data:{},headers}).promise,e=>e.status===403);
 await assert.rejects(call('/api/v2/reader/growth?action=feed',{data:{userId:admin}}).promise,e=>e.status===400);
 await assert.rejects(call('/api/v2/reader/growth?action=feed',{result:{works:[{...work,rating:'AGE_19'}]}}).promise,e=>e.status===503);
});
test('reader, author and SUPER_ADMIN roles reject impersonation and incorrect methods/queries',async()=>{
 await assert.rejects(call('/api/v2/creator/growth?workId=1').promise,e=>e.code==='AUTHOR_REQUIRED');
 await assert.rejects(call('/api/v2/admin/growth',{who:{userId:reader,admin:{role:'SUB_ADMIN',is_active:true}}}).promise,e=>e.status===403);
 await assert.rejects(call('/api/v2/admin/growth',{who:{userId:reader,admin:{role:'SUPER_ADMIN',is_active:false}}}).promise,e=>e.status===403);
 for(const path of ['/api/v2/creator/growth?workId=0','/api/v2/creator/growth?workId=9223372036854775808','/api/v2/reader/growth?action=reset&workId=1','/api/v2/reader/growth?unknown=1'])
  await assert.rejects(call(path,{data:{}}).promise,e=>[400,405].includes(e.status));
 await assert.rejects(call('/api/v2/reader/growth?action=reset').promise,e=>e.status===405);
 const own=call('/api/v2/creator/growth?workId=1',{who:{userId:admin,author:{id:'1',status:'APPROVED'}},result:{workId:'1'}});await own.promise;
 assert.equal(own.calls[0].init.body.p_user,admin);assert.equal(own.calls[0].init.body.p_data.workId,'1');
 await assert.rejects(call('/api/v2/admin/growth',{who:{userId:admin,admin:{role:'SUPER_ADMIN',is_active:true}},result:{error:'ACCOUNT_INACTIVE',status:403}}).promise,e=>e.status===403);
});
test('policy and preference validation bounds dates, numbers, webtoon denominator and immutable versions',async()=>{
 assert.equal(validGrowthPolicy(config),true);
 for(const p of [{...config,minReaders:4},{...config,minEpisodes:0},{...config,minCompletionRate:NaN},{...config,endsAt:'infinity'},
  {...config,type:'WEBTOON'},{...config,startsAt:'2026-01-01',endsAt:'2026-12-01'},{...config,hypothesis:'<script>bad</script>'},{...config,owner:reader}])assert.equal(validGrowthPolicy(p),false);
 const who={userId:admin,admin:{role:'SUPER_ADMIN',is_active:true}};
 for(const data of [{version:'v1',config:{...config,minReaders:0}},{version:'../bad',config}])await assert.rejects(call('/api/v2/admin/growth?action=configure',{who,data}).promise,e=>e.status===400);
 const ok=call('/api/v2/admin/growth?action=configure',{who,data:{version:'v1',config},result:{version:'v1'}});await ok.promise;assert.equal(ok.calls[0].init.body.p_action,'configure');
 for(const data of [{excludedGenres:Array(9).fill('장르'),frequency:'OFF',analyticsConsent:false},{excludedGenres:[],frequency:'HOURLY',analyticsConsent:true},
  {excludedGenres:[],frequency:'OFF',analyticsConsent:'true'}])await assert.rejects(call('/api/v2/reader/growth?action=save-preferences',{data}).promise,e=>e.status===400);
 await call('/api/v2/reader/growth?action=save-preferences',{data:{excludedGenres:[],frequency:'OFF',analyticsConsent:false}}).promise;
 await assert.rejects(call('/api/v2/admin/growth?action=evaluate',{who,data:{workId:1,version:'v1'}}).promise,e=>e.status===400);
 await call('/api/v2/admin/growth?action=evaluate',{who,data:{workId:'1',version:'v1'}}).promise;
});
test('decisions require sample/time/cost/retention/supply/guardrail evidence and do not imply success',async()=>{
 const who={userId:admin,admin:{role:'SUPER_ADMIN',is_active:true}},data={version:'v1',decision:'CHANGE',reason:'표본 부족으로 후속 관찰이 필요합니다.',evidence:{sampleSize:0,observedDays:7,costKrw:0,retentionSummary:'재방문 분모가 아직 성숙하지 않았습니다.',supplySummary:'신인 공급은 추가 관찰이 필요합니다.',guardrailSummary:'소수 장르 편향을 확인할 표본이 없습니다.'}};
 await call('/api/v2/admin/growth?action=decide',{who,data}).promise;
 for(const patch of [{decision:'WIN'},{evidence:{}},{evidence:{...data.evidence,sampleSize:-1}},{reason:'짧음'}])await assert.rejects(call('/api/v2/admin/growth?action=decide',{who,data:{...data,...patch}}).promise,e=>e.status===400);
});
const seoFetch=items=>async(url)=>new URL(url).pathname.endsWith('p0_migration_status')?Response.json([{version:'p0-20260921',phase:'locked'}]):Response.json({items});
test('server share escapes HTML, uses fixed canonical and rejects private/unsafe cover URLs',async()=>{
 const item={id:'35',title:'<img onerror="x"> & 작품',description:'<script>secret()</script>',cover:'https://fixture.supabase.co/storage/v1/object/sign/authoring-covers/private?token=private'};
 let response=await growthSeo(new Request('https://hostile.test/share/35'),env,{workId:'35',fetchImpl:seoFetch([item])});const html=await response.text();
 assert.equal(response.status,200);assert.match(html,/&lt;img/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('token=private'));assert.match(html,/https:\/\/example.test\/works\/35/);assert.ok(!html.includes('hostile.test'));
 response=await growthSeo(new Request('https://example.test/share/35'),env,{workId:'35',fetchImpl:seoFetch([{...item,cover:'/images/cover.png'}])});assert.match(await response.text(),/og:image/);
 assert.equal((await growthSeo(new Request('https://example.test/share/35'),env,{workId:'35',fetchImpl:seoFetch([])})).status,404);
 for(const origin of ['http://example.test','https://user:pass@example.test','https://example.test/path'])assert.equal((await growthSeo(new Request('https://example.test/sitemap.xml'),{...env,GROWTH_CANONICAL_ORIGIN:origin})).status,503);
 assert.equal((await growthSeo(new Request('https://example.test/share/x'),env,{workId:'../bad'})).status,404);
});
test('sitemap is bounded UTF-8 absolute public URLs and fails rather than silently truncating',async()=>{
 const r=await growthSeo(new Request('https://example.test/sitemaps/0/index.xml'),env,{bucket:'0',fetchImpl:seoFetch([{id:'35',title:'작품',lastModified:'2026-10-09T01:00:00Z'}])});
 assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/xml.*utf-8/);assert.match(await r.text(),/<loc>https:\/\/example.test\/works\/35<\/loc>/);
 assert.equal((await growthSeo(new Request('https://example.test/sitemaps/0/index.xml'),env,{bucket:'0',fetchImpl:seoFetch(Array(1001).fill({id:'1',title:'작품'}))})).status,503);
 assert.equal((await growthSeo(new Request('https://example.test/sitemap.xml',{method:'POST'}),env)).status,405);
 assert.equal((await growthSeo(new Request('https://example.test/sitemap.xml'),{})).status,503);
});
test('Cron independently runs bounded growth batch, no HTTP trigger or swallowed publication failure',async()=>{
 const saved=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json({evaluated:20,dryRun:true});};
 try{
  await worker.scheduled({}, {...env,AUTHOR_PUBLISH_ENABLED:'false'},{waitUntil(){}});assert.equal(calls.length,1);assert.match(calls[0].url,/run_growth_evaluations/);assert.deepEqual(calls[0].body,{p_limit:20});
  await worker.scheduled({}, {...env,GROWTH_SERVICE_ENABLED:'false',AUTHOR_PUBLISH_ENABLED:'false'},{waitUntil(){}});assert.equal(calls.length,1);
  await worker.scheduled({},env,{waitUntil(){}});assert.equal(calls.length,3);assert.equal((await worker.fetch()).status,404);
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url)});return new URL(url).pathname.endsWith('run_growth_evaluations')?Response.json({dryRun:true}):new Response('',{status:503});};
  await assert.rejects(worker.scheduled({},env,{waitUntil(){}}),/Scheduled job failed/);assert.ok(calls.at(-1).url.includes('run_growth_evaluations'));
  await assert.rejects(worker.scheduled({}, {...env,SUPABASE_URL:'https://evil.test'},{waitUntil(){}}),/configuration/);
 }finally{globalThis.fetch=saved;}
});
